export interface YouTubeSearchItem {
  videoId: string;
  title: string;
  description?: string;
  durationSec?: number;
}

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  description: string;
  tags?: string[];
  durationSec?: number;
}

/**
 * Mengubah ISO 8601 duration (misal PT1H23M45S, PT45S) menjadi detik.
 */
export function parseIsoDuration(duration: string): number {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Memeriksa apakah sebuah video termasuk kategori Shorts
 * berdasarkan durasi (<= 65 detik atau indikator shorts dalam durasi <= 180s),
 * hashtag, atau kata kunci shorts di judul/deskripsi/tags.
 */
export function isShortVideo(item: {
  title?: string;
  description?: string;
  durationSec?: number;
  tags?: string[];
}): boolean {
  // Jika durasi terdeteksi <= 65 detik, hampir dipastikan Shorts
  if (item.durationSec !== undefined && item.durationSec > 0 && item.durationSec <= 65) {
    return true;
  }

  // Teks gabungan judul, deskripsi, dan tags
  const tagsStr = (item.tags || []).join(" ").toLowerCase();
  const text = `${item.title || ""} ${item.description || ""} ${tagsStr}`.toLowerCase();

  // Tag / kata kunci yang secara eksplisit menandai Shorts / Reels / TikTok video
  const shortKeywords = [
    "#shorts",
    "#short",
    "#youtubeshorts",
    "#ytshorts",
    "#shortvideo",
    "#shortsvideo",
    "#reels",
    "#tiktok",
  ];

  if (shortKeywords.some((kw) => text.includes(kw))) {
    return true;
  }

  // Jika durasi <= 180s (3 menit) dan memiliki kata shorts sebagai kata tersendiri
  if (
    item.durationSec !== undefined &&
    item.durationSec <= 180 &&
    /\bshorts?\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

/**
 * Memverifikasi ke endpoint YouTube apakah sebuah videoId adalah YouTube Short.
 * YouTube secara otomatis me-redirect video reguler (status 303) ke /watch?v=,
 * sedangkan Shorts akan merespon status 200 tanpa redirect ke /watch?v=.
 */
export async function isShortVideoStrict(videoId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    // Status 301, 302, 303: Cek apakah redirect ke /watch?v= (video reguler)
    if (res.status === 301 || res.status === 302 || res.status === 303) {
      const location = res.headers.get("location") || "";
      if (location.includes("/watch?v=") || location.includes("watch")) {
        return false; // Video reguler!
      }
      return true; // Redirect ke URL shorts lain
    }

    // Status 200: video ini resmi berada di route /shorts/
    return res.status === 200;
  } catch {
    // Jika timeout atau network error, anggap bukan short agar tidak memblokir video reguler
    return false;
  }
}

/**
 * Mengambil detail video (deskripsi lengkap, tags, judul, durasi) dalam 1 batch request.
 */
export async function getVideoDetailsBatch(
  videoIds: string[]
): Promise<Map<string, YouTubeVideoDetails>> {
  const map = new Map<string, YouTubeVideoDetails>();
  if (!videoIds || videoIds.length === 0) return map;

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return map;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("id", videoIds.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          const durationSec = parseIsoDuration(item.contentDetails?.duration || "");
          map.set(item.id, {
            videoId: item.id,
            title: item.snippet?.title || "",
            description: item.snippet?.description || "",
            tags: item.snippet?.tags || [],
            durationSec,
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[getVideoDetailsBatch] Gagal fetch video details:`, err);
  }

  return map;
}

/**
 * Mencari video YouTube berdasarkan query menggunakan YouTube Data API v3,
 * dengan filter pencegahan video kategori Short dan fallback scraping publik.
 */
export async function searchYouTubeVideos(
  query: string,
  maxResults = 5
): Promise<YouTubeSearchItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();

  // Jika API Key tersedia, prioritaskan YouTube Data API v3 resmi
  if (apiKey) {
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("q", cleanQuery);
      url.searchParams.set("type", "video");
      // Ambil lebih banyak kandidat (misal 15-25) agar setelah Shorts dibuang, jumlahnya tetap mencukupi
      const fetchCount = Math.min(Math.max(maxResults * 3, 15), 25);
      url.searchParams.set("maxResults", String(fetchCount));
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString());

      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const candidateIds = data.items
            .map((item: any) => item.id?.videoId)
            .filter(Boolean);

          // Ambil detail durasi & deskripsi lengkap sekaligus untuk semua kandidat
          const detailsMap = await getVideoDetailsBatch(candidateIds);

          const regularVideos: YouTubeSearchItem[] = [];

          for (const item of data.items) {
            const videoId = item.id?.videoId;
            if (!videoId) continue;

            const details = detailsMap.get(videoId);
            const title = details?.title || item.snippet?.title || "";
            const description = details?.description || item.snippet?.description || "";
            const durationSec = details?.durationSec;
            const tags = details?.tags || [];

            // 1. Cek filter cepat berdasarkan durasi, hashtag, dan keywords
            if (isShortVideo({ title, description, durationSec, tags })) {
              continue;
            }

            // 2. Jika durasi <= 180s (potensi Shorts baru), periksa langsung ke YouTube endpoint
            if (durationSec !== undefined && durationSec <= 180) {
              const isShort = await isShortVideoStrict(videoId);
              if (isShort) continue;
            }

            regularVideos.push({
              videoId,
              title,
              description,
              durationSec,
            });

            if (regularVideos.length >= maxResults) break;
          }

          return regularVideos;
        }
        return [];
      } else {
        console.warn(
          `[searchYouTubeVideos] YouTube API gagal (status ${res.status}). Beralih ke fallback public search.`
        );
      }
    } catch (err) {
      console.warn(
        `[searchYouTubeVideos] Error memanggil YouTube API: ${err}. Beralih ke fallback public search.`
      );
    }
  }

  // Fallback: Scraping halaman pencarian YouTube publik jika API key belum ada / quota habis
  return await searchYouTubeScrape(cleanQuery, maxResults);
}

/**
 * Fallback pencarian video YouTube tanpa API key dengan membaca metadata publik,
 * mengabaikan shelf Shorts dan memvalidasi keaslian video reguler.
 */
async function searchYouTubeScrape(
  query: string,
  maxResults: number
): Promise<YouTubeSearchItem[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      }
    );

    if (!res.ok) return [];

    const html = await res.text();
    const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);

    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      const contents =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

      const candidateVideos: { videoId: string; title: string; isLikelyShort: boolean }[] = [];

      for (const item of contents) {
        // Abaikan shelf shorts / reels sepenuhnya
        if (item.reelShelfRenderer || item.shortsLockupViewModel || item.reelItemRenderer) continue;

        const renderer = item.videoRenderer;
        if (renderer?.videoId && renderer?.title?.runs?.[0]?.text) {
          const title = renderer.title.runs[0].text;
          const navUrl =
            renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || "";

          // Periksa indikator shorts (URL /shorts/, hashtag #shorts, atau durasi <= 60 detik)
          const isShortUrl = navUrl.includes("/shorts/");
          const hasShortTag = isShortVideo({ title });
          const lengthText = renderer.lengthText?.simpleText || "";
          const isShortDuration = /^0:(?:[0-5]?[0-9])$/.test(lengthText.trim());

          if (isShortUrl || hasShortTag || isShortDuration) {
            continue;
          }

          // Deteksi apakah durasi di bawah 3 menit (bisa jadi potensi Shorts)
          const isUnder3Mins = /^([0-2]):[0-5][0-9]$/.test(lengthText.trim()) || !lengthText;

          candidateVideos.push({
            videoId: renderer.videoId,
            title,
            isLikelyShort: isUnder3Mins,
          });
        }
      }

      // Verifikasi kandidat yang lolos dengan isShortVideoStrict
      const verifiedVideos: YouTubeSearchItem[] = [];
      for (const cand of candidateVideos) {
        if (cand.isLikelyShort) {
          const isShort = await isShortVideoStrict(cand.videoId);
          if (isShort) continue;
        }

        verifiedVideos.push({
          videoId: cand.videoId,
          title: cand.title,
        });

        if (verifiedVideos.length >= maxResults) break;
      }

      return verifiedVideos;
    }

    // Fallback sekunder: Regex videoId dari HTML
    const idMatches = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
    if (idMatches) {
      const uniqueIds = Array.from(
        new Set(idMatches.map((m) => m.replace("/watch?v=", "")))
      );

      const verifiedVideos: YouTubeSearchItem[] = [];
      for (const id of uniqueIds) {
        const isShort = await isShortVideoStrict(id);
        if (!isShort) {
          verifiedVideos.push({
            videoId: id,
            title: `YouTube Video (${id})`,
          });
        }
        if (verifiedVideos.length >= maxResults) break;
      }

      return verifiedVideos;
    }

    return [];
  } catch (error) {
    console.error("[searchYouTubeScrape] Gagal melakukan search fallback:", error);
    return [];
  }
}
