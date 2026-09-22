import { NextRequest, NextResponse } from "next/server";
import { searchYouTubeVideos } from "@/lib/youtube";
import { getVideoTranscript } from "@/lib/transcript";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "belajar";

  const report: Record<string, any> = {
    env: {
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY
        ? `✅ Ada (${process.env.YOUTUBE_API_KEY.slice(0, 8)}...)`
        : "❌ TIDAK ADA",
      AI_API_KEY: process.env.AI_API_KEY
        ? `✅ Ada (${process.env.AI_API_KEY.slice(0, 6)}...)`
        : "❌ TIDAK ADA",
      AI_PROVIDER: process.env.AI_PROVIDER || "❌ TIDAK ADA",
    },
    youtubeSearch: null,
    transcriptTest: null,
  };

  // Step 1: Test YouTube search
  try {
    const videos = await searchYouTubeVideos(query, 3);
    report.youtubeSearch = {
      status: videos.length > 0 ? "✅ Berhasil" : "⚠️ Tidak ada hasil",
      count: videos.length,
      videos: videos.map((v) => ({ videoId: v.videoId, title: v.title })),
    };

    // Step 2: Test transcript untuk video pertama
    if (videos.length > 0) {
      const firstVideo = videos[0];
      try {
        const transcript = await getVideoTranscript(firstVideo.videoId);
        report.transcriptTest = {
          videoId: firstVideo.videoId,
          title: firstVideo.title,
          status:
            transcript.length > 0
              ? `✅ Berhasil (${transcript.length} segmen)`
              : "❌ Transcript kosong / tidak tersedia",
          sampleText: transcript.slice(0, 3).map((t) => t.text),
        };
      } catch (err: any) {
        report.transcriptTest = {
          videoId: firstVideo.videoId,
          status: `❌ Error: ${err?.message || err}`,
        };
      }
    }
  } catch (err: any) {
    report.youtubeSearch = {
      status: `❌ Error: ${err?.message || err}`,
    };
  }

  return NextResponse.json(report, { status: 200 });
}
