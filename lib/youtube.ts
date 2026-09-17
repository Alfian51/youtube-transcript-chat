export interface YouTubeSearchItem {
  videoId: string;
  title: string;
}

/**
 * Mencari video YouTube berdasarkan query menggunakan YouTube Data API v3,
 * dengan fallback scraping publik jika API key belum diset atau quota habis.
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
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString());

      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          return data.items.map((item: any) => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
          }));
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
 * Fallback pencarian video YouTube tanpa API key dengan membaca metadata publik.
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

      const videos: YouTubeSearchItem[] = [];

      for (const item of contents) {
        const renderer = item.videoRenderer;
        if (renderer?.videoId && renderer?.title?.runs?.[0]?.text) {
          videos.push({
            videoId: renderer.videoId,
            title: renderer.title.runs[0].text,
          });
        }
        if (videos.length >= maxResults) break;
      }

      return videos;
    }

    // Fallback sekunder: Regex videoId dari HTML
    const idMatches = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
    if (idMatches) {
      const uniqueIds = Array.from(
        new Set(idMatches.map((m) => m.replace("/watch?v=", "")))
      ).slice(0, maxResults);

      return uniqueIds.map((id) => ({
        videoId: id,
        title: `YouTube Video (${id})`,
      }));
    }

    return [];
  } catch (error) {
    console.error("[searchYouTubeScrape] Gagal melakukan search fallback:", error);
    return [];
  }
}
