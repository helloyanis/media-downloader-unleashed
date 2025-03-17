let requests
document.addEventListener('DOMContentLoaded', async () => {
    const mediaUrl = new URLSearchParams(document.location.search).get('mediaUrl');
    const mediaSize = new URLSearchParams(document.location.search).get('selectedSize');
    const isStream = new URLSearchParams(document.location.search).get('isStream');
    const videoExtensions = [".flv", ".avi", ".wmv", ".mov", ".mp4", ".m3u8"];
    const audioExtensions = [".pcm", ".wav", ".mp3", ".aac", ".ogg", ".wma"];
    requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: mediaUrl });
    const mediaExtension = getFileExtension(mediaUrl);

    let mediaBlobUrl = mediaUrl; // Default to direct URL

    if (localStorage.getItem('download-method') === 'fetch') {
        try {
            const mediaBlob = await fetchMedia(mediaUrl, mediaSize);
            mediaBlobUrl = URL.createObjectURL(mediaBlob);
        } catch (error) {
            console.error("Error fetching media file:", error);
            return; // Stop execution if fetching fails
        }
    }

    if (videoExtensions.includes(mediaExtension)) {
        const video = document.createElement('video');
        video.controls = true;
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
        document.body.appendChild(video);

        if (mediaExtension === ".m3u8" || isStream === '1') {
            if (Hls.isSupported()) {
                // HLS.js configuration : Set referrer header (to avoid 403 error) if fetched with fetch API
                let config = {}
                if(localStorage.getItem('download-method') === 'fetch') {
                    config = {
                        fetchSetup: function (context, initParams) {
                            initParams.referrer = requests[mediaUrl][mediaSize].requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value;
                            initParams.method = requests[mediaUrl][mediaSize].method;
                            initParams.headers = new Headers();
                            requests[mediaUrl][mediaSize].requestHeaders.forEach(header => {
                                initParams.headers.append(header.name, header.value);
                            });
                            return new Request(context.url, initParams);
                        },
                        progressive: true // Use the fetch API instead of XHR
                    };
                }
                console.log(config)
                const hls = new Hls(config);
                hls.loadSource(mediaBlobUrl);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    video.play();
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = mediaBlobUrl;
                video.addEventListener('loadedmetadata', () => {
                    video.play();
                });
            } else {
                console.error("Can't play HLS file.");
            }
        } else {
            video.src = mediaBlobUrl;
        }
    } else if (audioExtensions.includes(mediaExtension)) {
        const audio = document.createElement('audio');
        audio.src = mediaBlobUrl;
        audio.controls = true;
        audio.style.width = '100%';
        document.body.appendChild(audio);
    }
});

async function fetchMedia(url, size) {
    console.log('Fetching media file:', url);

    // Find the closest matching URL key
    const requestKey = Object.keys(requests).find(storedUrl => storedUrl.includes(url));
    
    if (!requestKey || !requests[requestKey] || requests[requestKey].length === 0) {
        throw new Error(`No matching request found for ${url}`);
    }

    const requestData = requests[requestKey][size];

    const forbiddenHeaders = [
        "Accept-Charset", "Accept-Encoding", "Access-Control-Request-Headers", "Access-Control-Request-Method",
        "Connection", "Content-Length", "Cookie", "Date", "DNT", "Expect", "Host", "Keep-Alive", "Origin",
        "Permissions-Policy", "Referer", "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Via"
    ];

    const headers = requestData.requestHeaders.filter(header => 
        !forbiddenHeaders.includes(header.name) && !header.name.startsWith('Sec-') && !header.name.startsWith('Proxy-')
    );

    const headersObject = {};
    headers.forEach(header => {
        headersObject[header.name] = header.value;
    });

    const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: headersObject,
        referrer: requestData.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }

    return response.blob();
}


function getFileExtension(url) {
    try {
        let parsedUrl = new URL(url);
        let pathname = parsedUrl.pathname;
        let fileName = pathname.substring(pathname.lastIndexOf('/') + 1);
        fileName = fileName.split('?')[0];
        fileName = fileName.substring(fileName.lastIndexOf('.'));
        return fileName;
    } catch (error) {
        console.error("Invalid URL", error);
        return null;
    }
}
