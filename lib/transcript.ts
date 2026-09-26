import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";

export interface TranscriptItem {
  /** Teks cuplikan transcript / subtitle */
  text: string;
  /** Offset waktu dalam detik */
  offset: number;
}

export interface GetVideoTranscriptOptions {
  /** Kode bahasa transcript opsional, misal 'id' atau 'en' */
  lang?: string;
  /** Jumlah percobaan ulang bila terjadi error jaringan sementara (default: 2) */
  maxRetries?: number;
  /** Jeda awal antar retry dalam milidetik (default: 500) */
  retryDelayMs?: number;
}

/**
 * Membersihkan teks transcript dari whitespace berlebih dan newline.
 */
function cleanTranscriptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// In-memory cache untuk transcript per videoId dan bahasa (TTL: 1 jam)
interface CachedTranscript {
  items: TranscriptItem[];
  timestamp: number;
}
const transcriptCache = new Map<string, CachedTranscript>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 jam

/**
 * Mengambil transcript dari video YouTube tanpa membutuhkan YouTube Data API key resmi.
 *
 * TRADE-OFF PENGGUNAAN SCRAPING (youtube-transcript):
 * 1. Keuntungan:
 *    - Gratis tanpa konsumsi kuota resmi YouTube Data API v3.
 *    - Tidak memerlukan registrasi GCP / API Key khusus.
 * 2. Keterbatasan & Trade-off:
 *    - Video tanpa caption/subtitle (baik manual maupun auto-generated) tidak akan memiliki transcript.
 *    - Video dengan batasan umur (age-restricted), region-locked, atau private tidak dapat diakses.
 *    - Sangat bergantung pada endpoint publik YouTube; jika YouTube mengubah struktur respon
 *      atau menerapkan IP rate-limiting, request berpotensi gagal.
 *
 * Oleh karena itu, fungsi ini dilengkapi:
 * - In-memory caching per videoId agar tidak melakukan request berulang untuk video yang sama.
 * - Retry mechanism untuk error jaringan/rate-limiting sementara.
 * - Penanganan aman: Mengembalikan array kosong `[]` jika transcript tidak ada/gagal,
 *   sehingga pemanggil tidak akan mengalami crash (unhandled exception).
 *
 * @param videoId ID video YouTube (misal "dQw4w9WgXcQ" atau full URL)
 * @param options Opsi tambahan seperti bahasa dan retry
 * @returns Promise berisi array { text: string; offset: number } dalam detik
 */
/**
 * Mengambil transcript melalui Supadata API (solusi cloud anti-bot untuk Vercel / serverless).
 * Dapatkan free API key di https://supadata.ai
 */
async function fetchTranscriptViaSupadata(videoId: string): Promise<TranscriptItem[]> {
  const apiKey = process.env.SUPADATA_API_KEY?.trim();
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=false`,
      {
        headers: {
          "x-api-key": apiKey,
        },
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Supadata] Gagal fetch transcript (${res.status}):`, errText);
      return [];
    }

    const data = await res.json();
    const rawList = Array.isArray(data?.content)
      ? data.content
      : Array.isArray(data?.transcript)
      ? data.transcript
      : [];

    const items: TranscriptItem[] = [];
    for (const item of rawList) {
      const text = cleanTranscriptText(item.text);
      if (!text) continue;
      const rawOffset =
        item.offset !== undefined
          ? item.offset
          : item.start !== undefined
          ? item.start
          : 0;
      const offset =
        rawOffset > 500 ? Math.floor(rawOffset / 1000) : Math.floor(rawOffset);
      items.push({ text, offset });
    }

    return items;
  } catch (err) {
    console.warn(`[Supadata] Terjadi error:`, err);
    return [];
  }
}

/**
 * Mengambil transcript melalui RapidAPI YouTube Transcript (alternatif proxy cloud).
 */
async function fetchTranscriptViaRapidApi(videoId: string): Promise<TranscriptItem[]> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://youtube-transcriptor.p.rapidapi.com/transcript?video_id=${encodeURIComponent(videoId)}`,
      {
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "youtube-transcriptor.p.rapidapi.com",
        },
      }
    );

    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.transcript || [];
    return list
      .map((item: any) => ({
        text: cleanTranscriptText(item.text || item.transcription || ""),
        offset: Math.floor(Number(item.start || item.offset || 0)),
      }))
      .filter((i: TranscriptItem) => !!i.text);
  } catch (err) {
    console.warn(`[RapidAPI] Terjadi error:`, err);
    return [];
  }
}

export async function getVideoTranscript(
  videoId: string,
  options: GetVideoTranscriptOptions = {}
): Promise<TranscriptItem[]> {
  const { lang, maxRetries = 2, retryDelayMs = 500 } = options;

  if (!videoId || typeof videoId !== "string" || !videoId.trim()) {
    return [];
  }

  const cleanVideoId = videoId.trim();
  const cacheKey = `${cleanVideoId}_${lang || "auto"}`;

  // 1. Cek dari in-memory cache jika masih dalam batas TTL
  const cached = transcriptCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.items;
  }

  // 2. Jika SUPADATA_API_KEY tersedia, prioritaskan (sangat stabil di cloud Vercel)
  if (process.env.SUPADATA_API_KEY?.trim()) {
    const supaItems = await fetchTranscriptViaSupadata(cleanVideoId);
    if (supaItems.length > 0) {
      transcriptCache.set(cacheKey, { items: supaItems, timestamp: Date.now() });
      return supaItems;
    }
  }

  // 3. Jika RAPIDAPI_KEY tersedia, gunakan RapidAPI
  if (process.env.RAPIDAPI_KEY?.trim()) {
    const rapidItems = await fetchTranscriptViaRapidApi(cleanVideoId);
    if (rapidItems.length > 0) {
      transcriptCache.set(cacheKey, { items: rapidItems, timestamp: Date.now() });
      return rapidItems;
    }
  }

  // 4. Default: Menggunakan scraping langsung (bekerja mulus di lingkungan lokal/IP perumahan)
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const rawTranscripts = await YoutubeTranscript.fetchTranscript(cleanVideoId, {
        ...(lang ? { lang } : {}),
      });

      if (!Array.isArray(rawTranscripts) || rawTranscripts.length === 0) {
        break;
      }

      // Deteksi apakah respon menggunakan milidetik (srv3 InnerTube)
      const usesMilliseconds = rawTranscripts.some(
        (item) => item.offset > 500 || (item.duration !== undefined && item.duration > 60)
      );

      const items: TranscriptItem[] = [];

      for (const item of rawTranscripts) {
        const text = cleanTranscriptText(item.text);
        if (!text) continue;

        const offset = usesMilliseconds
          ? Math.floor(item.offset / 1000)
          : Math.floor(item.offset);

        items.push({ text, offset });
      }

      // Simpan ke cache jika transcript ditemukan
      if (items.length > 0) {
        transcriptCache.set(cacheKey, {
          items,
          timestamp: Date.now(),
        });
      }

      return items;
    } catch (err: any) {
      if (
        err instanceof YoutubeTranscriptDisabledError ||
        err instanceof YoutubeTranscriptNotAvailableError ||
        err instanceof YoutubeTranscriptNotAvailableLanguageError ||
        err instanceof YoutubeTranscriptVideoUnavailableError
      ) {
        console.warn(
          `[getVideoTranscript] Video "${cleanVideoId}" tidak memiliki transcript yang tersedia (${err.constructor.name}).`
        );
        break;
      }

      attempt++;

      if (attempt > maxRetries) {
        console.warn(
          `[getVideoTranscript] Gagal mengambil transcript untuk video "${cleanVideoId}" setelah ${maxRetries} retry: ${err?.message || err}`
        );
        break;
      }

      const delay = retryDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return [];
}

/**
 * Mengekstrak daftar chapter / timestamp resmi yang dicantumkan pembuat video di deskripsi.
 * Contoh format di deskripsi:
 * 01:23 = Pendahuluan
 * 03:45 Tutorial Dasar
 */
export function extractChaptersFromDescription(description: string): TranscriptItem[] {
  if (!description) return [];
  const lines = description.split("\n");
  const items: TranscriptItem[] = [];
  const timeRegex = /(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2}))/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const mins = parseInt(match[2], 10);
      const secs = parseInt(match[3], 10);
      const offset = hours * 3600 + mins * 60 + secs;
      const text = cleanTranscriptText(
        line.replace(timeRegex, "").replace(/[-=:–—|]/g, " ")
      );
      if (text && text.length > 2) {
        items.push({ offset, text });
      }
    }
  }

  return items;
}

/**
 * Menghasilkan segmen transcript fallback cerdas dari judul dan ringkasan deskripsi video
 * jika YouTube memblokir pengambilan subtitle (misalnya di lingkungan server cloud Vercel).
 */
export function createFallbackTranscriptFromVideo(
  title: string,
  description: string = ""
): TranscriptItem[] {
  const items: TranscriptItem[] = [
    { offset: 0, text: cleanTranscriptText(title) },
  ];

  if (description) {
    // Ambil baris-baris deskripsi yang informatif (bukan link atau hashtag)
    const informativeLines = description
      .split("\n")
      .map((l) => cleanTranscriptText(l))
      .filter((l) => l.length > 15 && !l.startsWith("http") && !l.startsWith("#"))
      .slice(0, 5);

    informativeLines.forEach((text, idx) => {
      items.push({
        offset: (idx + 1) * 25,
        text,
      });
    });
  }

  return items;
}

