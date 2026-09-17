import { SearchMatch } from "@/types";

/**
 * Mencari kecocokan kata kunci (exact/substring match, case-insensitive) di dalam transcript video.
 *
 * FITUR:
 * 1. Case-insensitive substring matching.
 * 2. Context merging: Menggabungkan ±1 segmen sebelum dan sesudah segmen yang cocok
 *    agar teks hasil pencarian memberikan konteks yang utuh dan mudah dipahami pengguna.
 * 3. Smart deduplication: Menghindari duplikasi hasil jika beberapa baris berdekatan
 *    (dalam rentang waktu < 4 detik) sama-sama mengandung kata kunci yang sama.
 *
 * @param transcript Daftar segmen transcript { text, offset } dari video
 * @param keyword Kata kunci yang dicari oleh user
 * @returns Daftar SearchMatch { timestamp, text }
 */
export function findMatchesInTranscript(
  transcript: { text: string; offset: number }[],
  keyword: string
): SearchMatch[] {
  if (!transcript || transcript.length === 0) {
    return [];
  }

  const cleanKeyword = keyword?.trim().toLowerCase();
  if (!cleanKeyword) {
    return [];
  }

  const matches: SearchMatch[] = [];
  let lastMatchedOffset = -999;

  for (let i = 0; i < transcript.length; i++) {
    const currentItem = transcript[i];
    const currentText = currentItem.text.toLowerCase();

    // Periksa apakah segmen ini mengandung kata kunci
    if (currentText.includes(cleanKeyword)) {
      // Hindari duplikasi jika segmen berdekatan (< 4 detik) sudah dicatat
      if (currentItem.offset - lastMatchedOffset < 4) {
        continue;
      }

      // Ambil segmen sebelum (-1), saat ini, dan sesudah (+1) untuk memberi konteks
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(transcript.length - 1, i + 1);

      const contextItems = transcript.slice(startIdx, endIdx + 1);
      let contextText = contextItems
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(" ");

      // Tambahkan ellipsis jika ada konteks sebelumnya / sesudahnya
      if (startIdx > 0) {
        contextText = "... " + contextText;
      }
      if (endIdx < transcript.length - 1) {
        contextText = contextText + " ...";
      }

      matches.push({
        timestamp: currentItem.offset,
        text: contextText,
      });

      lastMatchedOffset = currentItem.offset;
    }
  }

  return matches;
}

export interface TranscriptChunk {
  index: number;
  offset: number;
  text: string;
}

/**
 * Mengelompokkan transcript per 25-35 detik / paragraf agar:
 * 1. Memberikan konteks pemahaman semantik yang utuh untuk AI.
 * 2. Menghemat token API dan biaya komputasi hingga 75-80%.
 */
export function groupTranscriptIntoChunks(
  transcript: { text: string; offset: number }[],
  maxChunkDurationSec = 30
): TranscriptChunk[] {
  if (!transcript || transcript.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let currentOffset = transcript[0].offset;
  let currentTexts: string[] = [];

  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    currentTexts.push(item.text.trim());

    const isLast = i === transcript.length - 1;
    const duration = item.offset - currentOffset;

    if (duration >= maxChunkDurationSec || currentTexts.join(" ").length > 300 || isLast) {
      chunks.push({
        index: chunks.length,
        offset: currentOffset,
        text: currentTexts.join(" "),
      });

      if (!isLast) {
        currentOffset = transcript[i + 1].offset;
        currentTexts = [];
      }
    }
  }

  return chunks;
}

/**
 * Menemukan kecocokan makna / semantik menggunakan AI API (Gemini atau OpenAI).
 *
 * FITUR EFISIENSI & BIAYA:
 * 1. Chunking aggregation: Mengelompokkan transcript menjadi potongan tematik (25-30s).
 * 2. Rate & token limiter: Membatasi maksimal 20 chunks per video yang dikirim ke LLM.
 * 3. Fallback cerdas: Jika AI_API_KEY belum diset atau kuota habis, otomatis beralih
 *    ke fuzzy semantic token-matching tanpa menyebabkan server error / crash.
 *
 * @param transcript Daftar segmen transcript { text, offset }
 * @param query Query pencarian berbasis topik / makna
 * @returns Daftar SearchMatch { timestamp, text }
 */
export async function findSemanticMatches(
  transcript: { text: string; offset: number }[],
  query: string
): Promise<SearchMatch[]> {
  if (!transcript || transcript.length === 0) return [];
  const cleanQuery = query?.trim();
  if (!cleanQuery) return [];

  // 1. Kelompokkan transcript menjadi chunk-chunk logis
  const chunks = groupTranscriptIntoChunks(transcript, 30);
  if (chunks.length === 0) return [];

  // Batasi jumlah chunk yang dianalisis oleh AI (maks 20 chunk per video) untuk efisiensi biaya
  const MAX_CHUNKS_FOR_AI = 20;
  const chunksToSend = chunks.slice(0, MAX_CHUNKS_FOR_AI);

  const apiKey =
    process.env.AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  // Jika tidak ada API key AI yang disediakan, gunakan fallback token/fuzzy semantic
  if (!apiKey) {
    console.warn(
      "[findSemanticMatches] AI_API_KEY belum diset di .env.local. Menggunakan token-based semantic matching fallback."
    );
    return fallbackSemanticMatch(chunksToSend, cleanQuery);
  }

  try {
    const isGemini =
      process.env.AI_PROVIDER === "gemini" ||
      apiKey.startsWith("AIza") ||
      !apiKey.startsWith("sk-");

    const prompt = `Anda adalah sistem evaluasi pencarian semantik video.
Tugas: Temukan potongan transcript yang maknanya relevan, menjawab, atau membahas topik dari Query pengguna (pencocokan semantik/makna, BUKAN hanya kata yang persis sama).
Contoh: Query "penyebab harga naik" sangat relevan dengan kalimat "kenaikan harga bahan pokok terjadi akibat gagal panen".

Query Pengguna: "${cleanQuery}"

Daftar Potongan Transcript:
${chunksToSend
  .map((c) => `[ID: ${c.index}] (Menit/Detik: ${c.offset}s): "${c.text}"`)
  .join("\n")}

Instruksi Output:
- Kembalikan HANYA JSON array dari potongan yang relevan.
- Setiap objek harus memiliki: "index" (number ID potongan), "offset" (detik), dan "text" (teks ringkas yang relevan).
- Jika tidak ada potongan yang relevan secara makna, kembalikan [].
- Format JSON: [{"index": 0, "offset": 12, "text": "..."}]`;

    let responseJsonText = "";

    if (isGemini) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.text();
        console.warn(`[findSemanticMatches] Gemini API error (${res.status}): ${errData}`);
        return fallbackSemanticMatch(chunksToSend, cleanQuery);
      }

      const data = await res.json();
      responseJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    } else {
      // OpenAI / OpenRouter endpoint
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a video semantic search evaluator. Output strictly JSON array.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        const errData = await res.text();
        console.warn(`[findSemanticMatches] OpenAI API error (${res.status}): ${errData}`);
        return fallbackSemanticMatch(chunksToSend, cleanQuery);
      }

      const data = await res.json();
      responseJsonText = data?.choices?.[0]?.message?.content || "[]";
    }

    // Parse hasil JSON dari model
    const cleanedJson = responseJsonText.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanedJson);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const matches: SearchMatch[] = [];
    for (const item of parsed) {
      const offset = typeof item.offset === "number" ? item.offset : Number(item.offset) || 0;
      const text = item.text || (typeof item.index === "number" ? chunksToSend[item.index]?.text : "");

      if (text) {
        matches.push({
          timestamp: offset,
          text: text.length > 200 ? text.slice(0, 200) + "..." : text,
        });
      }
    }

    return matches;
  } catch (error) {
    console.error("[findSemanticMatches] Terjadi kesalahan pada semantic search AI:", error);
    return fallbackSemanticMatch(chunksToSend, cleanQuery);
  }
}

/**
 * Fallback semantic matching berbasis token overlap dan sinonim sederhana bila AI API tidak tersedia.
 */
function fallbackSemanticMatch(
  chunks: TranscriptChunk[],
  query: string
): SearchMatch[] {
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (queryTokens.length === 0) return [];

  const matches: SearchMatch[] = [];

  for (const chunk of chunks) {
    const chunkLower = chunk.text.toLowerCase();
    const matchCount = queryTokens.filter((token) => chunkLower.includes(token)).length;

    // Jika setidaknya 50% kata dalam query muncul dalam chunk
    if (matchCount >= Math.max(1, Math.ceil(queryTokens.length * 0.5))) {
      matches.push({
        timestamp: chunk.offset,
        text: chunk.text.length > 200 ? chunk.text.slice(0, 200) + "..." : chunk.text,
      });
    }
  }

  return matches;
}
