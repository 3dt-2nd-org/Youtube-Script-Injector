console.log("[EXT-CONTENT] Bridge Loaded");

const API_BASE_URL = "https://acv-project.koreacentral.cloudapp.azure.com";
// const API_BASE_URL = "http://localhost:8000";

// 상태 관리 변수 (cachedMetadata 추가)
let cachedSubtitleData = null; 
let cachedMetadata = null;     
let isLeader = false;          
let subtitleUploaded = false;  
let eventSource = null;        
let currentVideoId = null;     

function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
}

function inject() {
    if (document.getElementById('yt-sub-interceptor')) return;
    const s = document.createElement('script');
    s.id = 'yt-sub-interceptor';
    s.src = chrome.runtime.getURL('inject.js');
    (document.head || document.documentElement).appendChild(s);
}

// API 서버로 POST 전송 (페이로드 통합)
async function uploadSubtitle(videoId, data, metadata) {
    if (subtitleUploaded) return; 
    
    console.log(`[EXT-CONTENT] 📤 데이터 서버 전송 중... (Leader)`);
    
    // 서버에서 요구하는 VideoMetadata 포함 구조로 매핑
    const requestPayload = {
        metadata: {
            video_id: videoId,
            ...metadata
        },
        subtitle_data: data
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/subtitles/${videoId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log("[EXT-CONTENT] ✅ 서버 전송 완료:", result);
            subtitleUploaded = true;
        } else {
            console.error("[EXT-CONTENT] ❌ 서버 전송 거부:", response.status);
        }
    } catch (error) {
        console.error("[EXT-CONTENT] ❌ 서버 전송 실패:", error);
    }
}

// 자막 버튼 강제 조작 함수 (기존과 동일)
function forceSubtitleFetch() {
    console.log("[EXT-CONTENT] ⏳ 자막 버튼 탐색 및 조작 대기 중...");
    let attempts = 0;
    const maxAttempts = 20; 

    const tryToggle = () => {
        const ccButton = document.querySelector('.ytp-subtitles-button');
        
        if (!ccButton || ccButton.style.display === 'none' || ccButton.getAttribute('aria-pressed') === null) {
            attempts++;
            if (attempts >= maxAttempts) return;
            setTimeout(tryToggle, 500);
            return;
        }

        const isPressed = ccButton.getAttribute('aria-pressed') === 'true';

        if (isPressed) {
            ccButton.click(); 
            setTimeout(() => { ccButton.click(); }, 300);
        } else {
            ccButton.click(); 
        }
    };
    setTimeout(tryToggle, 500);
}

function connectSSE(videoId) {
    if (eventSource) eventSource.close();

    console.log(`[EXT-CONTENT] 🔌 SSE 연결 시도: ${videoId}`);
    eventSource = new EventSource(`${API_BASE_URL}/api/stream/${videoId}`);

    eventSource.addEventListener("extract_command", (e) => {
        isLeader = true;
        
        // 인과관계 교차검증 1: 캐싱 검증 조건에 metadata 추가
        if (cachedSubtitleData && cachedMetadata && !subtitleUploaded) {
            uploadSubtitle(videoId, cachedSubtitleData, cachedMetadata);
        } else {
            forceSubtitleFetch(); 
        }
    });

    eventSource.addEventListener("waiting", (e) => {
        console.log("%c[EXT-CONTENT] 👥 Follower 상태", "color: #03a9f4;");
    });

    eventSource.addEventListener("progress", (e) => {
        const data = JSON.parse(e.data);
        console.log(`[EXT-CONTENT] 🔄 진행 상태: ${data.status}`);
    });

    eventSource.addEventListener("complete", (e) => {
        const data = JSON.parse(e.data);
        console.log("%c[EXT-CONTENT] 🎯 최종 분석 리포트 수신!", "background: green; color: white; padding: 2px 5px;");
        eventSource.close(); 
    });

    eventSource.addEventListener("error", (e) => {
        if (e.data) {
            eventSource.close();
        }
    });
}

function init() {
    const videoId = getVideoId();
    if (!videoId) return;

    if (videoId === currentVideoId && eventSource && eventSource.readyState !== EventSource.CLOSED) {
        return;
    }

    currentVideoId = videoId;
    cachedSubtitleData = null;
    cachedMetadata = null;
    isLeader = false;
    subtitleUploaded = false;
    
    inject();
    connectSSE(videoId);
}

init();
window.addEventListener('yt-navigate-finish', init);

window.addEventListener('message', (event) => {
    if (event.data.type === "YT_SUB_DATA") {
        console.log("%c[EXT-CONTENT] 📥 데이터 캐싱 완료", "background: #222; color: #bada55;");
        
        cachedSubtitleData = event.data.payload;
        cachedMetadata = event.data.metadata;

        // 인과관계 교차검증 2
        if (isLeader && !subtitleUploaded) {
            const videoId = getVideoId();
            uploadSubtitle(videoId, cachedSubtitleData, cachedMetadata);
        }
    }
});