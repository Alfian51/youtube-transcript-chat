import { NextRequest, NextResponse } from "next/server";
import { searchYouTubeVideos, getVideoDetailsBatch, isShortVideo } from "@/lib/youtube";
import {
  getVideoTranscript,
  extractChaptersFromDescription,
} from "@/lib/transcript";
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
    // 1. Cari video relevan di YouTube (maksimal 6 video reguler, tanpa shorts)
    const videos = await searchYouTubeVideos(query, 6);

    if (!videos || videos.length === 0) {
      return NextResponse.json([]);
    }

    // 2. Ambil detail deskripsi video secara batch (1 request cepat untuk semua video)
    const videoIds = videos.map((v) => v.videoId);
    const detailsMap = await getVideoDetailsBatch(videoIds);

    // Filter keluar video kategori Shorts (durasi <= 65 detik atau memuat indikator Shorts)
    const regularVideos = videos.filter((video) => {
      const details = detailsMap.get(video.videoId);
      return !isShortVideo({
        title: details?.title || video.title,
        description: details?.description || video.description,
        durationSec: details?.durationSec || video.durationSec,
        tags: details?.tags,
      });
    });

    if (regularVideos.length === 0) {
      return NextResponse.json([]);
    }

    // 3. Jalankan proses transcript + matching secara paralel dengan batas concurrency
    const processedResults = await pMap(
      regularVideos,
      async (video) => {
        try {
          const details = detailsMap.get(video.videoId);
          const description = details?.description || video.description || "";
          const fullTitle = details?.title || video.title;

          // Coba ambil transcript asli (subtitle / closed captions ucapan video)
          let transcript = await getVideoTranscript(video.videoId);

          // Jika transcript otomatis tidak tersedia, cek apakah kreator menulis chapter resmi di deskripsi
          if (!transcript || transcript.length === 0) {
            const chapters = extractChaptersFromDescription(description);
            if (chapters.length > 0) {
              transcript = chapters;
            }
          }

          // Jika video tidak memiliki transkrip ucapan asli / chapter resmi, lewati video ini
          // agar tidak menampilkan menit perkiraan atau teks deskripsi palsu
          if (!transcript || transcript.length === 0) {
            return null;
          }

          // Pencocokan kata kunci pada ucapan di dalam video
          let matches =
            mode === "semantic"
              ? await findSemanticMatches(transcript, query)
              : findMatchesInTranscript(transcript, query);

          // Jika exact match tidak menemukan frasa yang persis, coba semantic search
          if ((!matches || matches.length === 0) && mode === "exact") {
            matches = await findSemanticMatches(transcript, query);
          }

          // Hanya tampilkan video jika benar-benar ada kata kunci yang diucapkan di video
          // JANGAN membuat timestamp palsu 00:00 jika tidak ditemukan
          if (!matches || matches.length === 0) {
            return null;
          }

          const result: VideoSearchResult = {
            videoId: video.videoId,
            title: fullTitle,
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

    // 4. Filter keluar video yang null
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
