let player = null;
let isPlayerReady = false;
let currentVideoId = 'L_LUpnjgPso'; 

// Memuat YouTube API secara dinamis
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtubePlayer', {
        height: '100%',
        width: '100%',
        videoId: currentVideoId, 
        playerVars: { 'playsinline': 1, 'autoplay': 0 },
        events: {
            'onReady': () => { isPlayerReady = true; }
        }
    });
}

// Fungsi melompat ke detik tertentu di video
function loadAndSeekVideo(videoId, seconds) {
    if (isPlayerReady && player) {
        const currentVideoUrl = player.getVideoUrl ? player.getVideoUrl() : '';
        if (!currentVideoUrl.includes(videoId)) {
            currentVideoId = videoId;
            player.loadVideoById({ videoId: videoId, startSeconds: seconds });
        } else {
            player.seekTo(seconds, true);
            player.playVideo();
        }
    } else {
        alert("Sistem sedang memuat player YouTube. Harap tunggu sebentar.");
    }
}

// MENGHUBUNGKAN KE FASTAPI / SUPABASE BACKEND
async function cariVideo() {
    const query = document.getElementById('searchInput').value.trim();
    const resultsList = document.getElementById('resultsList');

    if(!query) return alert('Ketik kata kuncinya dulu!');

    resultsList.innerHTML = `<p class="text-blue-500 font-semibold animate-pulse">Memproses transkrip & mencari kata kunci...</p>`;

    try {
        // Ganti URL ini jika Backend Supabase/Vercel sudah memberikan Endpoint Publik
        const backendUrl = `http://127.0.0.1:5000/api/search?video_id=${currentVideoId}&q=${encodeURIComponent(query)}`;
        
        const response = await fetch(backendUrl);

        if (!response.ok) {
            throw new Error(`HTTP Error Status: ${response.status}`);
        }

        const data = await response.json();
        renderResults(data, query);

    } catch (error) {
        console.error("Detail Error:", error);
        resultsList.innerHTML = `
            <div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
                <p class="font-bold">Gagal terhubung ke Backend!</p>
                <p class="mt-1">Pesan error: ${error.message}</p>
            </div>
        `;
    }
}

// Render data hasil pencarian ke antarmuka
function renderResults(data, query) {
    const resultsList = document.getElementById('resultsList');
    resultsList.innerHTML = "";

    if (!data || data.length === 0) {
        resultsList.innerHTML = `<p class="text-gray-400 text-sm">Hasil tidak ditemukan.</p>`;
        return;
    }

    data.forEach(item => {
        const videoCard = document.createElement('div');
        videoCard.className = "border rounded-lg p-3 bg-gray-50 space-y-2";

        if (!item.matches || item.matches.length === 0) {
            videoCard.innerHTML = `
                <h3 class="font-bold text-sm text-gray-800">🎬 ${item.title}</h3>
                <p class="text-gray-400 text-xs italic">Kata kunci "<mark>${query}</mark>" tidak ditemukan dalam video ini.</p>
            `;
        } else {
            let matchesHtml = "";
            item.matches.forEach(m => {
                const minutes = Math.floor(m.timestamp / 60).toString().padStart(2, '0');
                const seconds = Math.floor(m.timestamp % 60).toString().padStart(2, '0');

                matchesHtml += `
                    <button onclick="loadAndSeekVideo('${item.videoId}', ${m.timestamp})" 
                            class="w-full text-left p-2 rounded bg-white hover:bg-blue-50 border border-gray-200 transition text-xs">
                        <span class="font-bold text-blue-600">📍 Menit ${minutes}:${seconds}</span>
                        <p class="text-gray-600 mt-1">${m.text}</p>
                    </button>
                `;
            });

            videoCard.innerHTML = `
                <h3 class="font-bold text-sm text-gray-800 line-clamp-1">🎬 ${item.title}</h3>
                <div class="space-y-1">${matchesHtml}</div>
            `;
        }

        resultsList.appendChild(videoCard);
    });
}