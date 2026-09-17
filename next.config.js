/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // Wajib ditambahkan agar bisa di-hosting ke Firebase
  images: {
    unoptimized: true, // Wajib ditambahkan karena Firebase tidak mendukung image optimization bawaan Next.js secara static
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
    ],
  },
};

module.exports = nextConfig;