let requests
// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}
document.addEventListener('DOMContentLoaded', async () => {
    // Show the help dialog if it hasn't been dismissed
    document.querySelector("#dontremindme").addEventListener("click", function () {
        localStorage.setItem('dontremindme', '1');
        document.querySelector("#previewhelp").open = false;
    });
    mdui.setColorScheme(localStorage.getItem('interfaceColor'));
    document.querySelector("#previewhelp").open = localStorage.getItem('dontremindme') !== '1';


    const mediaUrl = new URLSearchParams(document.location.search).get('mediaUrl');
    const mediaSize = new URLSearchParams(document.location.search).get('selectedSize');
    const isStream = new URLSearchParams(document.location.search).get('isStream');
    const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"]
    const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
    const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
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

    if (videoExtensions.includes(mediaExtension) || streamExtensions.includes(mediaExtension) || isStream === '1') {
        const video = document.createElement('video');
        video.controls = true;
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
        document.body.appendChild(video);

        if (streamExtensions.includes(mediaExtension) || isStream === '1') {
            if (Hls.isSupported()) {
                // HLS.js configuration : Set referrer header (to avoid 403 error) if fetched with fetch API
                let config = {}
                if (localStorage.getItem('download-method') === 'fetch') {
                    console.log('Using fetch API for HLS.js')
                    config = {
                        fetchSetup: function (context, initParams) {
                            const headers = new Headers();
                            requests[mediaUrl][mediaSize].requestHeaders.forEach(header => {
                                headers.append(header.name, header.value);
                            });

                            initParams.headers = headers;
                            initParams.referrer = requests[mediaUrl][mediaSize].requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value;
                            initParams.method = requests[mediaUrl][mediaSize].method;

                            return new Request(context.url, initParams); // OR: return fetch(context.url, initParams);
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
                hls.on(Hls.Events.ERROR, function (event, data) {
                    console.error("HLS.js error", data);
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.error("Fatal network error encountered, trying to recover...");
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.error("Fatal media error encountered, trying to recover...");
                                hls.recoverMediaError();
                                break;
                            default:
                                console.error("Unrecoverable error. Destroying HLS instance.");
                                hls.destroy();
                                break;
                        }
                    }
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
