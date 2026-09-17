import { NextRequest, NextResponse } from "next/server";
import { getVideoTranscript } from "@/lib/transcript";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const queryVideoId = request.nextUrl.searchParams.get("videoId")?.trim();

  // Jika user menyertakan param ?videoId=..., uji video tersebut secara spesifik
  if (queryVideoId) {
    const startTime = Date.now();
    const transcript = await getVideoTranscript(queryVideoId);
    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      videoId: queryVideoId,
      durationMs,
      totalSegments: transcript.length,
      sampleFirst3: transcript.slice(0, 3),
      sampleLast1: transcript.length > 0 ? transcript[transcript.length - 1] : null,
    });
  }

  // Jika dipanggil tanpa parameter, jalankan pengujian default pada 2 skenario:
  // 1. Video yang memiliki transcript / auto-caption (contoh: Rick Astley "dQw4w9WgXcQ")
  // 2. Video yang transcript-nya disabled / tidak ada (contoh: "_1234567890")
  const testCases = [
    {
      description: "Video dengan caption aktif (harus sukses return list transcript)",
      videoId: "dQw4w9WgXcQ",
    },
    {
      description: "Video tanpa caption / ID invalid (harus gracefully return array kosong [])",
      videoId: "_1234567890",
    },
  ];

  const results = [];

  for (const tc of testCases) {
    const start = Date.now();
    const transcript = await getVideoTranscript(tc.videoId);
    const timeTaken = Date.now() - start;

    results.push({
      description: tc.description,
      videoId: tc.videoId,
      timeTakenMs: timeTaken,
      itemCount: transcript.length,
      sample: transcript.slice(0, 3),
      status:
        tc.videoId === "dQw4w9WgXcQ"
          ? transcript.length > 0
            ? "PASSED (Transcript retrieved successfully)"
            : "FAILED (Expected transcript items)"
          : transcript.length === 0
          ? "PASSED (Safely returned empty array without crash)"
          : "UNEXPECTED",
    });
  }

  return NextResponse.json({
    message: "Verifikasi lib/transcript.ts",
    results,
  });
}
