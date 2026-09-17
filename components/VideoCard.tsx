import { VideoSearchResult } from "@/types";

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface VideoCardProps {
  result: VideoSearchResult;
  activeVideoId: string | null;
  activeTimestamp: number | null;
  onSelectTimestamp: (videoId: string, timestamp: number) => void;
}

export default function VideoCard({
  result,
  activeVideoId,
  activeTimestamp,
  onSelectTimestamp,
}: VideoCardProps) {
  return (
    <div className="mb-4 rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <span aria-hidden>🎬</span>
        <h3 className="text-sm font-semibold text-navy">{result.title}</h3>
      </div>
      <div className="divide-y divide-gray-100">
        {result.matches.map((match, idx) => {
          const isActive =
            activeVideoId === result.videoId &&
            activeTimestamp === match.timestamp;
          return (
            <button
              key={`${result.videoId}-${match.timestamp}-${idx}`}
              onClick={() => onSelectTimestamp(result.videoId, match.timestamp)}
              className={`block w-full px-4 py-3 text-left transition hover:bg-blue-50 ${
                isActive ? "bg-blue-50" : "bg-white"
              }`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium text-blue-600">
                <span aria-hidden>📍</span>
                Menit {formatTimestamp(match.timestamp)}
              </div>
              <p className="mt-1 text-sm text-gray-600">{match.text}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
