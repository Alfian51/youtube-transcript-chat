# VideoSearch AI

Aplikasi pencarian kata kunci di dalam isi video YouTube (bukan hanya judul/deskripsi).

## Status saat ini (Stage 0–1)

- ✅ Scaffolding project Next.js 14 + TypeScript + Tailwind
- ✅ Kontrak tipe data (`types/index.ts`) — **jangan diubah bentuknya** di stage berikutnya
- ✅ Frontend: search bar, video player, panel hasil pencarian per menit (sesuai mockup)
- ✅ `/api/search` masih **dummy data** (belum integrasi YouTube API asli)
- ⬜ Stage 2: integrasi YouTube Data API v3
- ⬜ Stage 3: ambil transcript video
- ⬜ Stage 4: exact search di transcript
- ⬜ Stage 5: AI semantic search
- ⬜ Stage 6: polish & deploy

## Cara menjalankan

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Buka http://localhost:3000, ketik kata kunci apa saja (data masih dummy sampai Stage 2 diimplementasikan), lalu klik "Cari".

## Kontrak JSON API

`GET /api/search?q=<keyword>` mengembalikan:

```json
[
  {
    "videoId": "L_LUpnjgPso",
    "title": "Judul Video Pertama",
    "matches": [
      { "timestamp": 10, "text": "...cuplikan kalimat yang cocok..." },
      { "timestamp": 35, "text": "...cuplikan kalimat lainnya..." }
    ]
  }
]
```

`timestamp` dalam detik (bukan mm:ss) — frontend yang memformat untuk tampilan dan menggunakannya untuk membuka video pada detik yang tepat.

## Struktur folder

```
app/
  page.tsx              -> halaman utama
  api/search/route.ts   -> endpoint pencarian (masih dummy)
components/
  SearchBar.tsx
  VideoPlayer.tsx
  SearchResults.tsx
  VideoCard.tsx
types/
  index.ts              -> kontrak tipe data
```

## Stage selanjutnya

Lihat file prompt bertahap yang sudah dibuat sebelumnya untuk Stage 2–6
(integrasi YouTube API, transcript, exact search, AI semantic search, deploy).
