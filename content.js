console.log("[EXT-CONTENT] Bridge Loaded");

function inject() {
    if (document.getElementById('yt-sub-interceptor')) return;
    const s = document.createElement('script');
    s.id = 'yt-sub-interceptor';
    s.src = chrome.runtime.getURL('inject.js');
    (document.head || document.documentElement).appendChild(s);
    console.log("[EXT-CONTENT] inject.js Injected");
}

// 즉시 주입 및 페이지 이동 대응
inject();
window.addEventListener('yt-navigate-finish', inject);

// 데이터 수신 및 출력
window.addEventListener('message', (event) => {
    if (event.data.type === "YT_SUB_DATA") {
        const data = event.data.payload;
        console.log("%c[EXT-CONTENT] Subtitle Data Received!", "background: #222; color: #bada55; font-size: 12px;");
        
        // JSON 구조를 콘솔에서 바로 확인할 수 있게 출력
        console.dir(data); 
        
        // 전체 텍스트 추출 확인용
        if (data.events) {
            const text = data.events.filter(e => e.segs).map(e => e.segs.map(s => s.utf8).join("")).join(" ");
            console.log("[EXT-CONTENT] Full Text Sample:", text.substring(0, 200));
        }
    }
});