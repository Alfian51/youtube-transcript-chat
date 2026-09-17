import { VideoSearchResult } from "@/types";
import VideoCard from "./VideoCard";

interface SearchResultsProps {
  results: VideoSearchResult[];
  loading: boolean;
  hasSearched: boolean;
  activeVideoId: string | null;
  activeTimestamp: number | null;
  onSelectTimestamp: (videoId: string, timestamp: number) => void;
}

export default function SearchResults({
  results,
  loading,
  hasSearched,
  activeVideoId,
  activeTimestamp,
  onSelectTimestamp,
}: SearchResultsProps) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-navy">
        Hasil Pencarian Menit
      </h2>

      <div className="max-h-[420px] overflow-y-auto pr-1">
        {loading && (
          <p className="py-8 text-center text-sm text-gray-400">
            Mencari di dalam video...
          </p>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">
            Tidak ada hasil ditemukan.
          </p>
        )}

        {!loading &&
          results.map((result) => (
            <VideoCard
              key={result.videoId}
              result={result}
              activeVideoId={activeVideoId}
              activeTimestamp={activeTimestamp}
              onSelectTimestamp={onSelectTimestamp}
            />
          ))}

        {!loading && !hasSearched && (
          <p className="py-8 text-center text-sm text-gray-400">
            Ketik kata kunci lalu tekan Cari untuk mulai.
          </p>
        )}
      </div>
    </div>
  );
}
