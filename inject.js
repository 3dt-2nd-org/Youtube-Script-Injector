(function() {
    console.log("%c[EXT-INJECT] Interceptor Active (하이브리드 모드: 네트워크 캐시 + 폴백)", "color: blue; font-weight: bold;");

    // 단일 변수가 아닌, videoId를 키로 하는 객체(딕셔너리)로 캐싱하여 영상 간 데이터 섞임 방지
    const metadataCache = {};

    // API 응답 객체에서 메타데이터를 정제하는 함수
    function extractFromPlayerResponse(playerResponse) {
        try {
            if (!playerResponse || !playerResponse.videoDetails) return null;
            const details = playerResponse.videoDetails;
            const microformat = playerResponse.microformat?.playerMicroformatRenderer || {};

            return {
                videoId: details.videoId,
                title: details.title || "",
                description: details.shortDescription || "",
                channel_id: details.channelId || "",
                channel_title: details.author || "",
                published_at: microformat.publishDate || "",
                tags: details.keywords || []
            };
        } catch (e) {
            return null;
        }
    }

    // 메타데이터를 캐시에 저장
    function cacheMetadata(playerResponse) {
        const data = extractFromPlayerResponse(playerResponse);
        if (data && data.videoId) {
            metadataCache[data.videoId] = data;
            console.log(`%c[EXT-INJECT] 메타데이터 캐싱 완료 [${data.videoId}]`, "color: orange;");
        }
    }

    // URL에서 video_id 추출
    function extractVideoId(urlStr) {
        try {
            const url = new URL(urlStr.startsWith('http') ? urlStr : window.location.origin + urlStr);
            return url.searchParams.get('v');
        } catch(e) { return null; }
    }

    // [핵심 방어 로직] 자막이 메타데이터보다 먼저 로드되었을 때, 현재 플레이어에서 직접 강제 추출
    function getFallbackMetadata(targetVideoId) {
        try {
            const player = document.getElementById('movie_player');
            if (player && typeof player.getPlayerResponse === 'function') {
                const response = player.getPlayerResponse();
                const data = extractFromPlayerResponse(response);
                if (data && data.videoId === targetVideoId) {
                    console.log(`%c[EXT-INJECT] 폴백 API로 메타데이터 획득 성공 [${targetVideoId}]`, "color: #9c27b0;");
                    return data;
                }
            }
        } catch (e) {}
        
        // 서버 파싱 에러(422) 방지용 빈 객체 반환
        return { title: "", description: "", channel_id: "", channel_title: "", published_at: "", tags: [] };
    }

    // 1. 최초 진입 시점 처리
    if (window.ytInitialPlayerResponse) {
        cacheMetadata(window.ytInitialPlayerResponse);
    }

    // 2. Fetch 가로채기
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        // A. 메타데이터 갱신
        if (url && url.includes('/youtubei/v1/player')) {
            const response = await originalFetch(...args);
            const clone = response.clone();
            clone.json().then(data => cacheMetadata(data)).catch(e => console.error("[EXT-INJECT] Fetch Player Error", e));
            return response;
        }

        // B. 자막 데이터 가로채기
        const response = await originalFetch(...args);
        if (url && url.includes('api/timedtext')) {
            const videoId = extractVideoId(url);
            console.log(`%c[EXT-INJECT] Subtitle Fetch Detected! [${videoId}]`, "color: green;");
            
            const clone = response.clone();
            clone.json().then(data => {
                // 캐시에 있으면 캐시 사용, 없으면 Fallback 로직 즉시 실행
                const finalMetadata = (videoId && metadataCache[videoId]) ? metadataCache[videoId] : getFallbackMetadata(videoId);
                
                window.postMessage({ 
                    type: "YT_SUB_DATA", 
                    payload: data,
                    metadata: finalMetadata 
                }, "*");
            }).catch(e => console.error("[EXT-INJECT] JSON Parse Error (Fetch)", e));
        }
        return response;
    };

    // 3. XHR 가로채기
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function(method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function() {
        this.addEventListener('load', function() {
            // A. 메타데이터 갱신
            if (this._url && this._url.includes('/youtubei/v1/player')) {
                try {
                    const data = JSON.parse(this.responseText);
                    cacheMetadata(data);
                } catch (e) {}
            }

            // B. 자막 데이터 가로채기
            if (this._url && this._url.includes('api/timedtext')) {
                const videoId = extractVideoId(this._url);
                console.log(`%c[EXT-INJECT] Subtitle XHR Detected! [${videoId}]`, "color: green;");
                
                try {
                    const data = JSON.parse(this.responseText);
                    const finalMetadata = (videoId && metadataCache[videoId]) ? metadataCache[videoId] : getFallbackMetadata(videoId);
                    
                    window.postMessage({ 
                        type: "YT_SUB_DATA", 
                        payload: data,
                        metadata: finalMetadata 
                    }, "*");
                } catch (e) {
                    console.error("[EXT-INJECT] JSON Parse Error (XHR)", e);
                }
            }
        });
        return send.apply(this, arguments);
    };
})();