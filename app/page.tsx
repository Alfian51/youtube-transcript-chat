"use client";

import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import VideoPlayer from "@/components/VideoPlayer";
import SearchResults from "@/components/SearchResults";
import { VideoSearchResult } from "@/types";

export default function Home() {
  const [results, setResults] = useState<VideoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeTimestamp, setActiveTimestamp] = useState<number>(0);

  const handleSearch = async (query: string, mode: "exact" | "semantic" = "exact") => {
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`
      );
      const data: VideoSearchResult[] = await res.json();
      setResults(data);

      // Otomatis putar video pertama pada match pertamanya, seperti mockup.
      if (data.length > 0 && data[0].matches.length > 0) {
        setActiveVideoId(data[0].videoId);
        setActiveTimestamp(data[0].matches[0].timestamp);
      } else {
        setActiveVideoId(null);
      }
    } catch (err) {
      console.error("Gagal mengambil hasil pencarian:", err);
      setResults([]);
      setActiveVideoId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTimestamp = (videoId: string, timestamp: number) => {
    setActiveVideoId(videoId);
    setActiveTimestamp(timestamp);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-8 text-center text-3xl font-bold text-navy">
        Cari Kata Kunci di Video
      </h1>

      <SearchBar onSearch={handleSearch} loading={loading} />

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <VideoPlayer videoId={activeVideoId} startAt={activeTimestamp} />
        <SearchResults
          results={results}
          loading={loading}
          hasSearched={hasSearched}
          activeVideoId={activeVideoId}
          activeTimestamp={activeTimestamp}
          onSelectTimestamp={handleSelectTimestamp}
        />
      </div>
    </main>
  );
}
