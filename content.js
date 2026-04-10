console.log("[EXT-CONTENT] Bridge Loaded");

const API_BASE_URL = "http://127.0.0.1:8000"; // FastAPI 서버 주소

// 상태 관리 변수
let cachedSubtitleData = null; 
let isLeader = false;          
let subtitleUploaded = false;  
let eventSource = null;        
let currentVideoId = null;     // 중복 접속 방지용

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

// API 서버로 POST 전송
async function uploadSubtitle(videoId, data) {
    if (subtitleUploaded) return; 
    
    console.log(`[EXT-CONTENT] 📤 자막 데이터 서버로 전송 중... (Leader 역할 수행)`);
    try {
        const response = await fetch(`${API_BASE_URL}/api/subtitles/${videoId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: videoId, subtitle_data: data })
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

// =====================================================================
// [수정됨] 자막 버튼 비동기 탐색 및 강제 조작 함수 (Polling 적용)
// =====================================================================
function forceSubtitleFetch() {
    console.log("[EXT-CONTENT] ⏳ 자막 버튼 탐색 및 조작 대기 중...");
    let attempts = 0;
    const maxAttempts = 20; // 최대 10초 대기 (500ms * 20)

    const tryToggle = () => {
        const ccButton = document.querySelector('.ytp-subtitles-button');
        
        // 1. 버튼이 아직 DOM에 없거나 숨김 처리되어 있다면 0.5초 후 재시도
        if (!ccButton || ccButton.style.display === 'none' || ccButton.getAttribute('aria-pressed') === null) {
            attempts++;
            if (attempts >= maxAttempts) {
                console.error("[EXT-CONTENT] ❌ 최대 대기 시간을 초과하여 자막 자동 활성화를 중단합니다.");
                return;
            }
            setTimeout(tryToggle, 500);
            return;
        }

        // 2. 버튼이 완전히 로드된 것이 확인되면 상태를 판별하여 조작
        const isPressed = ccButton.getAttribute('aria-pressed') === 'true';

        if (isPressed) {
            console.log("[EXT-CONTENT] 🔄 자막이 켜져 있습니다. 패킷 유도를 위해 끄고 다시 켭니다.");
            ccButton.click(); // 끄기
            
            // YouTube UI 상태가 동기화될 딜레이를 확보한 뒤 다시 켜기
            setTimeout(() => {
                ccButton.click(); 
            }, 300);
        } else {
            console.log("[EXT-CONTENT] ▶️ 자막이 꺼져 있습니다. 데이터 가로채기를 위해 자막을 켭니다.");
            ccButton.click(); // 켜기
        }
    };

    // YouTube 내부 스크립트가 로딩될 최소한의 여유 시간을 두고 최초 탐색 시작
    setTimeout(tryToggle, 500);
}
// =====================================================================

// SSE 스트림 연결
function connectSSE(videoId) {
    if (eventSource) eventSource.close();

    console.log(`[EXT-CONTENT] 🔌 SSE 연결 시도: ${videoId}`);
    eventSource = new EventSource(`${API_BASE_URL}/api/stream/${videoId}`);

    eventSource.addEventListener("extract_command", (e) => {
        console.log("%c[EXT-CONTENT] 👑 Leader 권한 획득: 데이터 추출 확인 중...", "color: #ff9800; font-weight: bold;");
        isLeader = true;
        
        // 인과관계 교차검증 1: 
        // 권한을 받았을 때 이미 캐싱된 데이터가 있으면 바로 쏜다.
        // 데이터가 없다면(SPA 이동 직후 놓쳤거나 자막이 꺼져있다면) 버튼을 강제 조작한다.
        if (cachedSubtitleData && !subtitleUploaded) {
            uploadSubtitle(videoId, cachedSubtitleData);
        } else {
            forceSubtitleFetch(); 
        }
    });

    eventSource.addEventListener("waiting", (e) => {
        console.log("%c[EXT-CONTENT] 👥 Follower 상태: Leader의 진행을 대기 중입니다.", "color: #03a9f4;");
    });

    eventSource.addEventListener("progress", (e) => {
        const data = JSON.parse(e.data);
        console.log(`[EXT-CONTENT] 🔄 진행 상태: ${data.status}`);
    });

    eventSource.addEventListener("complete", (e) => {
        const data = JSON.parse(e.data);
        console.log("%c[EXT-CONTENT] 🎯 최종 분석 리포트 수신!", "background: green; color: white; padding: 2px 5px;");
        console.dir(data);
        eventSource.close(); 
    });

    eventSource.addEventListener("error", (e) => {
        if (e.data) {
            console.error("[EXT-CONTENT] ⚠️ 서버 측 에러 발생", e.data);
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
    isLeader = false;
    subtitleUploaded = false;
    
    inject();
    connectSSE(videoId);
}

init();
window.addEventListener('yt-navigate-finish', init);

window.addEventListener('message', (event) => {
    if (event.data.type === "YT_SUB_DATA") {
        console.log("%c[EXT-CONTENT] 📥 자막 패킷 가로채기 성공! (메모리에 캐싱됨)", "background: #222; color: #bada55;");
        
        cachedSubtitleData = event.data.payload;

        // 인과관계 교차검증 2
        if (isLeader && !subtitleUploaded) {
            const videoId = getVideoId();
            uploadSubtitle(videoId, cachedSubtitleData);
        }
    }
});