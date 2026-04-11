(function() {
    console.log("%c[EXT-INJECT] Interceptor Active (투트랙 모드: 자막 패킷 + 메타데이터)", "color: blue; font-weight: bold;");

    // 1. 전역 객체 기반 메타데이터 정적 추출
    function extractMetadata() {
        try {
            const playerResponse = window.ytInitialPlayerResponse;
            if (!playerResponse) return null;

            const details = playerResponse.videoDetails || {};
            const microformat = playerResponse.microformat?.playerMicroformatRenderer || {};

            return {
                title: details.title || "",
                description: details.shortDescription || "",
                channel_id: details.channelId || "",
                channel_title: details.author || "",
                published_at: microformat.publishDate || "",
                tags: details.keywords || []
            };
        } catch (e) {
            console.error("[EXT-INJECT] 메타데이터 추출 에러", e);
            return null;
        }
    }

    // 2. Fetch 가로채기 (수정)
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (url && url.includes('api/timedtext')) {
            console.log("%c[EXT-INJECT] Subtitle Fetch Detected!", "color: green;");
            const clone = response.clone();
            clone.json().then(data => {
                window.postMessage({ 
                    type: "YT_SUB_DATA", 
                    payload: data,
                    metadata: extractMetadata() // 메타데이터 동봉
                }, "*");
            }).catch(e => console.error("[EXT-INJECT] JSON Parse Error (Fetch)", e));
        }
        return response;
    };

    // 3. XHR 가로채기 (수정)
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function(method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function() {
        this.addEventListener('load', function() {
            if (this._url && this._url.includes('api/timedtext')) {
                console.log("%c[EXT-INJECT] Subtitle XHR Detected!", "color: green;");
                try {
                    const data = JSON.parse(this.responseText);
                    window.postMessage({ 
                        type: "YT_SUB_DATA", 
                        payload: data,
                        metadata: extractMetadata() // 메타데이터 동봉
                    }, "*");
                } catch (e) {
                    console.error("[EXT-INJECT] JSON Parse Error (XHR)", e);
                }
            }
        });
        return send.apply(this, arguments);
    };
})();