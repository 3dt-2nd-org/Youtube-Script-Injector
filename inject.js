(function() {
    console.log("%c[EXT-INJECT] Interceptor Active", "color: blue; font-weight: bold;");

    // --- Fetch 가로채기 ---
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (url && url.includes('api/timedtext')) {
            console.log("%c[EXT-INJECT] Subtitle Fetch Detected!", "color: green;");
            const clone = response.clone();
            clone.json().then(data => {
                console.log("[EXT-INJECT] Raw JSON Object:", data); // 여기서 JSON 직접 확인 가능
                window.postMessage({ type: "YT_SUB_DATA", payload: data }, "*");
            }).catch(e => console.error("[EXT-INJECT] JSON Parse Error (Fetch)", e));
        }
        return response;
    };

    // --- XHR 가로채기 ---
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
                    console.log("[EXT-INJECT] Raw JSON Object:", data); // 여기서 JSON 직접 확인 가능
                    window.postMessage({ type: "YT_SUB_DATA", payload: data }, "*");
                } catch (e) {
                    console.error("[EXT-INJECT] JSON Parse Error (XHR)", e);
                }
            }
        });
        return send.apply(this, arguments);
    };
})();