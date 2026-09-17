interface VideoPlayerProps {
  videoId: string | null;
  startAt: number;
}

export default function VideoPlayer({ videoId, startAt }: VideoPlayerProps) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-navy">Video Player</h2>
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        {videoId ? (
          <iframe
            key={`${videoId}-${startAt}`}
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${videoId}?start=${startAt}&autoplay=0`}
            title="YouTube video player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
            Pilih hasil pencarian untuk memutar video
          </div>
        )}
      </div>
    </div>
  );
}
