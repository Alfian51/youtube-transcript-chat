import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VideoSearch AI",
  description: "Cari kata kunci di dalam isi video YouTube",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
