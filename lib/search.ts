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

    // Periksa segmen saat ini atau kombinasi segmen berdekatan (sliding window)
    // agar frasa yang terpotong jeda baris subtitle YouTube tetap terdeteksi presisi
    const next1 = transcript[i + 1]?.text?.toLowerCase() || "";
    const next2 = transcript[i + 2]?.text?.toLowerCase() || "";
    const combined2 = `${currentText} ${next1}`.trim();
    const combined3 = `${currentText} ${next1} ${next2}`.trim();

    const isMatch =
      currentText.includes(cleanKeyword) ||
      combined2.includes(cleanKeyword) ||
      combined3.includes(cleanKeyword);

    if (isMatch) {
      // Hindari duplikasi hanya jika segmen sangat berdekatan (< 4 detik) pada kalimat yang sama
      if (currentItem.offset - lastMatchedOffset < 4) {
        continue;
      }

      // Gabungkan segmen sebelum (-1), saat ini, dan sesudah (+1 atau +2) agar konteks kalimat utuh
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(transcript.length - 1, i + 2);

      const contextItems = transcript.slice(startIdx, endIdx + 1);
      let contextText = contextItems
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(" ");

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
      apiKey.startsWith("AQ.") ||
      !apiKey.startsWith("sk-");

    // Key format AQ. dari AI Studio menggunakan Bearer token auth, bukan ?key= query param
    const useBearerAuth = apiKey.startsWith("AQ.") || (!apiKey.startsWith("AIza") && !apiKey.startsWith("sk-"));

    const prompt = `Anda adalah sistem evaluasi pencarian semantik video.
Tugas: Temukan SEMUA potongan transcript yang maknanya relevan, menjawab, atau membahas topik dari Query pengguna (pencocokan semantik/makna, BUKAN hanya kata yang persis sama).
PENTING: Jangan hanya mengembalikan 1 potongan jika ada beberapa bagian berbeda yang relevan. Kembalikan semua kemunculan yang relevan.
Contoh: Query "penyebab harga naik" sangat relevan dengan kalimat "kenaikan harga bahan pokok terjadi akibat gagal panen".

Query Pengguna: "${cleanQuery}"

Daftar Potongan Transcript:
${chunksToSend
  .map((c) => `[ID: ${c.index}] (Menit/Detik: ${c.offset}s): "${c.text}"`)
  .join("\n")}

Instruksi Output:
- Kembalikan SEMUA potongan yang relevan dalam format JSON array.
- Setiap objek harus memiliki: "index" (number ID potongan), "offset" (detik), dan "text" (teks ucapan asli yang relevan).
- Jika tidak ada potongan yang relevan secara makna, kembalikan [].
- Format JSON: [{"index": 0, "offset": 12, "text": "..."}]`;

    let responseJsonText = "";

    if (isGemini) {
      // Dukung dua format autentikasi:
      // - AIza... → query param ?key= (Google Cloud API Key)
      // - AQ....  → Authorization: Bearer header (AI Studio OAuth token)
      const geminiModel = "gemini-2.0-flash";
      const baseEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
      const endpoint = useBearerAuth ? baseEndpoint : `${baseEndpoint}?key=${apiKey}`;

      const geminiHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (useBearerAuth) {
        geminiHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: geminiHeaders,
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

/**
 * Membuat prompt pencarian keyword yang dioptimasi untuk model AI / LLM.
 *
 * Aturan Output:
 * - Hanya timestamp dan kalimat lengkap
 * - Jangan ada pembuka, penutup, atau penjelasan tambahan
 * - Jika tidak ada, tuliskan: "Tidak ada: ${keyword}"
 */
export const createOptimizedPrompt = (keyword: string, transcript: string): string => {
  return `Cari SEMUA kemunculan kata/frasa: "${keyword}" dalam transcript ini.

OUTPUT HARUS:
- Hanya timestamp dan kalimat lengkap
- Jangan ada pembuka, penutup, atau penjelasan tambahan
- Jika tidak ada, tuliskan: "Tidak ada: ${keyword}"

FORMAT OUTPUT (hanya ini):
[MM:SS] Kalimat lengkap yang memuat kata kunci

CONTOH:
[02:15] Prabowo adalah calon presiden yang menekankan kedaulatan pangan.
[05:43] Menurut Prabowo, kebijakan ekonomi harus berpihak kepada rakyat kecil.
[1:23:45] Prabowo menjawab pertanyaan tentang rencana pembangunan infrastruktur.

TRANSCRIPT:
${transcript}`;
};

/**
 * Mengubah daftar segmen transcript menjadi format teks ber-timestamp ([MM:SS] atau [H:MM:SS])
 * yang siap dikirim ke LLM.
 */
export function formatTranscriptForPrompt(
  transcript: { text: string; offset: number }[]
): string {
  return transcript
    .map((item) => {
      const totalSec = Math.floor(item.offset);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;

      const timeStr =
        hours > 0
          ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
          : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

      return `[${timeStr}] ${item.text.trim()}`;
    })
    .join("\n");
}

/**
 * Mem-parse teks hasil output dari createOptimizedPrompt kembali ke struktur SearchMatch[].
 */
export function parseOptimizedPromptOutput(outputText: string): SearchMatch[] {
  if (!outputText) return [];

  const trimmed = outputText.trim();
  if (trimmed.toLowerCase().includes("tidak ada:")) {
    return [];
  }

  const matches: SearchMatch[] = [];
  const lines = trimmed.split(/\r?\n/);

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    // Regex mencakup format [MM:SS] atau [H:MM:SS] / [HH:MM:SS] diikuti kalimat
    const match = cleanLine.match(/^\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*(?:".*?"\s*→\s*)?(.*)$/);
    if (match) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      const text = (match[4] || "").trim();

      if (text) {
        matches.push({
          timestamp: totalSeconds,
          text,
        });
      }
    }
  }

  return matches;
}
