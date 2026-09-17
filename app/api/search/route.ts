import { NextRequest, NextResponse } from "next/server";
import { searchYouTubeVideos } from "@/lib/youtube";
import { getVideoTranscript } from "@/lib/transcript";
import { findMatchesInTranscript, findSemanticMatches } from "@/lib/search";
import { VideoSearchResult } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Helper untuk membatasi concurrency eksekusi Promise secara paralel.
 */
async function pMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency = 3
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const mode = request.nextUrl.searchParams.get("mode")?.trim().toLowerCase() || "exact";

  if (!query) {
    return NextResponse.json(
      { error: "Parameter 'q' wajib diisi, contoh: /api/search?q=belajar+nextjs&mode=semantic" },
      { status: 400 }
    );
  }

  try {
    // 1. Cari video relevan di YouTube (maksimal 6 video)
    const videos = await searchYouTubeVideos(query, 6);

    if (!videos || videos.length === 0) {
      return NextResponse.json([]);
    }

    // 2. Jalankan proses transcript + matching secara paralel dengan batas concurrency (3 video sekaligus)
    const processedResults = await pMap(
      videos,
      async (video) => {
        try {
          // Ambil transcript video (dengan in-memory caching 1 jam agar hemat network)
          const transcript = await getVideoTranscript(video.videoId);

          if (!transcript || transcript.length === 0) {
            return null;
          }

          // Pilih metode pencarian: exact match atau AI semantic match
          const matches =
            mode === "semantic"
              ? await findSemanticMatches(transcript, query)
              : findMatchesInTranscript(transcript, query);

          // Jika tidak ada match pada transcript, exclude video ini
          if (!matches || matches.length === 0) {
            return null;
          }

          const result: VideoSearchResult = {
            videoId: video.videoId,
            title: video.title,
            matches,
          };

          return result;
        } catch (err) {
          console.error(`Error memproses video ${video.videoId}:`, err);
          return null;
        }
      },
      3 // Concurrency limit
    );

    // 3. Filter keluar video yang null (tidak punya transcript / tidak punya match)
    const finalResults: VideoSearchResult[] = processedResults.filter(
      (res): res is VideoSearchResult => res !== null
    );

    return NextResponse.json(finalResults);
  } catch (error: any) {
    console.error("[/api/search] Terjadi kesalahan saat mencari video:", error);
    return NextResponse.json(
      { error: "Gagal memproses pencarian video." },
      { status: 500 }
    );
  }
}
