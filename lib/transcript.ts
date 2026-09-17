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

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const rawTranscripts = await YoutubeTranscript.fetchTranscript(cleanVideoId, {
        ...(lang ? { lang } : {}),
      });

      if (!Array.isArray(rawTranscripts) || rawTranscripts.length === 0) {
        return [];
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
      // Error permanen: video tidak punya caption atau tidak tersedia
      // Tidak perlu retry, langsung return [] agar aman dan tidak crash.
      if (
        err instanceof YoutubeTranscriptDisabledError ||
        err instanceof YoutubeTranscriptNotAvailableError ||
        err instanceof YoutubeTranscriptNotAvailableLanguageError ||
        err instanceof YoutubeTranscriptVideoUnavailableError
      ) {
        console.warn(
          `[getVideoTranscript] Video "${cleanVideoId}" tidak memiliki transcript yang tersedia (${err.constructor.name}).`
        );
        return [];
      }

      attempt++;

      if (attempt > maxRetries) {
        console.warn(
          `[getVideoTranscript] Gagal mengambil transcript untuk video "${cleanVideoId}" setelah ${maxRetries} retry: ${err?.message || err}`
        );
        // Selalu return [] saat gagal, jangan crash
        return [];
      }

      // Jeda exponential backoff sebelum mencoba lagi
      const delay = retryDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return [];
}
