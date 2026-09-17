"use client";

import { useState } from "react";

interface SearchBarProps {
  onSearch: (query: string, mode: "exact" | "semantic") => void;
  loading: boolean;
}

export default function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"exact" | "semantic">("exact");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSearch(trimmed, mode);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-3">
      <div className="flex gap-3">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            mode === "exact"
              ? "Ketik kata kunci persis (contoh: Next.js, babi haram)..."
              : "Ketik konsep / topik makna (contoh: penyebab harga naik)..."
          }
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Mencari..." : "Cari"}
        </button>
      </div>

      {/* Toggle Mode: Exact vs AI Semantic */}
      <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
        <span className="font-medium">Metode:</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 shadow-inner">
          <button
            type="button"
            onClick={() => setMode("exact")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              mode === "exact"
                ? "bg-white text-blue-700 shadow-sm"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            Exact Match
          </button>
          <button
            type="button"
            onClick={() => setMode("semantic")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
              mode === "semantic"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <span>✨ AI Semantic</span>
          </button>
        </div>
      </div>
    </form>
  );
}
