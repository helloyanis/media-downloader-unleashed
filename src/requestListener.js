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


let urlList = [];
let headersSentListener, headersReceivedListener;
function initListener() {
    if(localStorage.getItem('detection-method') !== 'mime') {
        urlList = [
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
        ];
    } else {
        urlList = ["<all_urls>"];
    }
    //Check for event listener existence before adding a new one
    if (headersSentListener) {
        browser.webRequest.onSendHeaders.removeListener(headersSentListener);
    }
    //Add media request when request headers are sent
    headersSentListener = browser.webRequest.onSendHeaders.addListener(
        (details) => {
            let mediaRequest = {
                url: details.url,
                method: details.method,
                requestHeaders: details.requestHeaders,
                responseHeaders: null, // Placeholder for response headers
                size: null // Placeholder for media size
            };
            let existingRequests = JSON.parse(sessionStorage.getItem(details.url)) || [];
            existingRequests.push(mediaRequest);
            sessionStorage.setItem(details.url, JSON.stringify(existingRequests));
            console.log('Media request intercepted:', mediaRequest);
        },
        {
            urls: urlList,
        },
        ['requestHeaders']
    );
    
    //Check for event listener existence before adding a new one
    if (headersReceivedListener) {
        browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener);
    }
    //Add media size and response headers when response headers are received
    headersReceivedListener = browser.webRequest.onHeadersReceived.addListener(
        (details) => {
            let existingRequests = JSON.parse(sessionStorage.getItem(details.url)) || [];

            let mediaSizeHeader = details.responseHeaders.find(header => header.name.toLowerCase() === 'content-length');
            let size = mediaSizeHeader ? mediaSizeHeader.value : 'unknown';
    
            // Find the corresponding request and update its size and response headers
            for (let request of existingRequests) {
                if (!request.size) {
                    request.size = size;
                    request.responseHeaders = details.responseHeaders;
                    break;
                }
            }
    
            sessionStorage.setItem(details.url, JSON.stringify(existingRequests));
            console.log('Media response intercepted:', existingRequests);
        },
        {
            urls: urlList,
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

//Initialize the listener
initListener();


//Check if the listener should be reinitialized when message is received
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'initListener') {
        initListener();
    }
});

//Clear local storage when message is received
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'clearStorage') {
        sessionStorage.clear();
    }
});