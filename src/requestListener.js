// Description: This file contains the code to intercept media requests and responses and store them in session storage.
// The code is executed in the background script of the extension.

const mediaTypes = [
    "video/x-flv",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/quicktime",
    "video/mp4",
    "audio/x-pcm",
    "audio/wav",
    "audio/mpeg",
    "audio/aac",
    "audio/ogg",
    "audio/x-ms-wma",
    "application/vnd.apple.mpegurl",
    "application/x-mpegURL"
];



if(localStorage.getItem('detection-method') === 'url') {
    //Add media request when request headers are sent
    browser.webRequest.onSendHeaders.addListener(
        (details) => {
            let mediaRequest = {
                url: details.url,
                method: details.method,
                requestHeaders: details.requestHeaders
            }
            let existingRequests = JSON.parse(sessionStorage.getItem(details.url)) || [];
            existingRequests.push(mediaRequest);
            sessionStorage.setItem(details.url, JSON.stringify(existingRequests));
            console.log('Media request intercepted:', mediaRequest);
        },
        {
            urls: [
                "*://*/*.flv*",
                "*://*/*.avi*",
                "*://*/*.wmv*",
                "*://*/*.mov*",
                "*://*/*.mp4*",
                "*://*/*.pcm*",
                "*://*/*.wav*",
                "*://*/*.mp3*",
                "*://*/*.aac*",
                "*://*/*.ogg*",
                "*://*/*.wma*",
                "*://*/*.m3u8*"
            ],
        },
        ['requestHeaders']
    );
    //Add media size when response headers are received
    browser.webRequest.onHeadersReceived.addListener(
        (details) => {
            let existingRequests = JSON.parse(sessionStorage.getItem(details.url)) || [];
            let mediaSize = details.responseHeaders.find(header => header.name.toLowerCase() === 'content-length');
            let size = mediaSize ? mediaSize.value : 'unknown';

            // Find the corresponding request and update its size
            for (let request of existingRequests) {
                if (!request.size) {
                    request.size = size;
                    break;
                }
            }

            sessionStorage.setItem(details.url, JSON.stringify(existingRequests));
            console.log('Media response intercepted:', existingRequests);
        },
        {
            urls: [
                "*://*/*.flv*",
                "*://*/*.avi*",
                "*://*/*.wmv*",
                "*://*/*.mov*",
                "*://*/*.mp4*",
                "*://*/*.pcm*",
                "*://*/*.wav*",
                "*://*/*.mp3*",
                "*://*/*.aac*",
                "*://*/*.ogg*",
                "*://*/*.wma*",
                "*://*/*.m3u8*"
            ],
        },
        ['responseHeaders']
    );
} else if(localStorage.getItem('detection-method') === 'mime') {
    //Add media request when request headers are sent
    browser.webRequest.onSendHeaders.addListener(
        (details) => {
            let mediaRequest = {
                url: details.url,
                method: details.method,
                requestHeaders: details.requestHeaders
            }
            let existingRequests = JSON.parse(sessionStorage.getItem(details.url)) || [];
            existingRequests.push(mediaRequest);
            sessionStorage.setItem(details.url, JSON.stringify(existingRequests));
            console.log('Media request intercepted:', mediaRequest);
        },
        {
            urls: ["<all_urls>"],
        },
        ['requestHeaders']
    );
    // Check content type of the response and store the size if it's a media response
    browser.webRequest.onHeadersReceived.addListener(
        (details) => {
            let contentType = details.responseHeaders.find(header => header.name.toLowerCase() === 'content-type');
            if (contentType && mediaTypes.includes(contentType.value.split(';')[0])) {
                // If it's a media response, store the size
                let existingRequests = JSON.parse(sessionStorage.getItem(details.url)) || [];
                let mediaSize = details.responseHeaders.find(header => header.name.toLowerCase() === 'content-length');
                let size = mediaSize ? mediaSize.value : 'unknown';

                // Find the corresponding request and update its size
                for (let request of existingRequests) {
                    if (!request.size) {
                        request.size = size;
                        break;
                    }
                }

                // Update session storage with the media size
                sessionStorage.setItem(details.url, JSON.stringify(existingRequests));
                console.log('Media response intercepted:', existingRequests);
            } else {
                // If it's a non-media response, remove the corresponding entry from sessionStorage
                sessionStorage.removeItem(details.url);
                console.log('Non-media response, removed:', details.url);
            }
        },
        {
            urls: ["<all_urls>"]
        },
        ['responseHeaders']
    );
}

//Send media request data to the popup (session storage is not shared between background and popup scripts)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getMediaRequests') {
        let mediaRequests = {};
        for (let i = 0; i < sessionStorage.length; i++) {
            const url = sessionStorage.key(i);
            mediaRequests[url] = JSON.parse(sessionStorage.getItem(url));
        }
        sendResponse(mediaRequests);
    }
});