// Description: This file contains the code to intercept media requests and responses and store them in session storage.
// The code is executed in the background script of the extension.

// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}

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
    browser.storage.local.get('url-detection', function (result) {
        if (result['url-detection'] !== '1') {
            urlList = ["<all_urls>"];   //We filter it in popup.js because there are many filter options that can be selected
            // urlList = [
            //     "*://*/*.flv*",
            //     "*://*/*.avi*",
            //     "*://*/*.wmv*",
            //     "*://*/*.mov*",
            //     "*://*/*.mp4*",
            //     "*://*/*.pcm*",
            //     "*://*/*.wav*",
            //     "*://*/*.mp3*",
            //     "*://*/*.aac*",
            //     "*://*/*.ogg*",
            //     "*://*/*.wma*",
            //     "*://*/*.m3u8*",

            //     "*://*/*.3g2*",
            //     "*://*/*.3gp*",
            //     "*://*/*.asx*",
            //     "*://*/*.divx*",
            //     "*://*/*.f4v*",
            //     "*://*/*.ismv*",
            //     "*://*/*.m2t*",
            //     "*://*/*.m2ts*",
            //     "*://*/*.m2v*",
            //     "*://*/*.m4s*",
            //     "*://*/*.m4v*",
            //     "*://*/*.mk3d*",
            //     "*://*/*.mkv*",
            //     "*://*/*.mng*",
            //     "*://*/*.mp2v*",
            //     "*://*/*.mp4v*",
            //     "*://*/*.mpe*",
            //     "*://*/*.mpeg*",
            //     "*://*/*.mpeg1*",
            //     "*://*/*.mpeg2*",
            //     "*://*/*.mpeg4*",
            //     "*://*/*.mpg*",
            //     "*://*/*.mxf*",
            //     "*://*/*.ogm*",
            //     "*://*/*.ogv*",
            //     "*://*/*.qt*",
            //     "*://*/*.rm*",
            //     "*://*/*.swf*",
            //     "*://*/*.ts*",
            //     "*://*/*.vob*",
            //     "*://*/*.vp9*",
            //     "*://*/*.webm*",
            //     "*://*/*.3ga*",
            //     "*://*/*.ac3*",
            //     "*://*/*.adts*",
            //     "*://*/*.aif*",
            //     "*://*/*.aiff*",
            //     "*://*/*.alac*",
            //     "*://*/*.ape*",
            //     "*://*/*.asf*",
            //     "*://*/*.au*",
            //     "*://*/*.dts*",
            //     "*://*/*.f4a*",
            //     "*://*/*.f4b*",
            //     "*://*/*.flac*",
            //     "*://*/*.isma*",
            //     "*://*/*.it*",
            //     "*://*/*.m4a*",
            //     "*://*/*.m4b*",
            //     "*://*/*.m4r*",
            //     "*://*/*.mid*",
            //     "*://*/*.mka*",
            //     "*://*/*.mod*",
            //     "*://*/*.mp1*",
            //     "*://*/*.mp2*",
            //     "*://*/*.mp4a*",
            //     "*://*/*.mpa*",
            //     "*://*/*.mpga*",
            //     "*://*/*.oga*",
            //     "*://*/*.ogx*",
            //     "*://*/*.opus*",
            //     "*://*/*.ra*",
            //     "*://*/*.shn*",
            //     "*://*/*.spx*",
            //     "*://*/*.vorbis*",
            //     "*://*/*.weba*",
            //     "*://*/*.xm*",
            //     "*://*/*.f4f*",
            //     "*://*/*.f4m*",
            //     "*://*/*.mpd*",
            //     "*://*/*.smil*"
            // ];            
        } else {
            urlList = ["<all_urls>"];
        }

        // Check for event listener existence before adding a new one
        if (headersSentListener) {
            browser.webRequest.onSendHeaders.removeListener(headersSentListener);
        }

        // Add media request when request headers are sent
        headersSentListener = browser.webRequest.onSendHeaders.addListener(
            (details) => {
                let mediaRequest = {
                    url: details.url,
                    method: details.method,
                    requestHeaders: details.requestHeaders,
                    responseHeaders: null, // Placeholder for response headers
                    size: null // Placeholder for media size
                };

                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];
                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                    console.log('Media request intercepted:', mediaRequest);
                });
            },
            {
                urls: urlList,
            },
            ['requestHeaders']
        );

        // Check for event listener existence before adding a new one
        if (headersReceivedListener) {
            browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener);
        }

        // Add media size and response headers when response headers are received
        headersReceivedListener = browser.webRequest.onHeadersReceived.addListener(
            (details) => {
                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

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

                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                    console.log('Media response intercepted:', existingRequests);
                });
            },
            {
                urls: urlList,
            },
            ['responseHeaders']
        );
    });
}

// Send media request data to the popup (session storage is not shared between background and popup scripts)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getMediaRequests') {
        browser.storage.session.get(null, function (items) {
            sendResponse(items);
        });
        return true; // Indicate that the response will be sent asynchronously
    }
});

// Initialize the listener
initListener();

// Check if the listener should be reinitialized when message is received
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'initListener') {
        initListener();
    }
});

// Clear local storage when message is received
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'clearStorage') {
        browser.storage.session.clear();
    }
});

// This is used to open the popup.html file when the add-on icon is clicked, and to open the installed.md and when the add-on is installed.
browser.action.onClicked.addListener((tab) => {
    browser.storage.local.get('open-preference', function (result) {
        console.log('Open preference:', result['open-preference']);
        if (result['open-preference'] !== 'window') {
            // Open the popup in a new tab
            browser.tabs.create({
                url: browser.runtime.getURL(`popup.html`),
            });
        } else {
            // Open the popup in a new window
            browser.windows.create({
                url: browser.runtime.getURL(`popup.html`),
                type: 'popup',
                width: 800,
                height: 600,
            });
        }
    });
});

browser.runtime.onInstalled.addListener(() => {
    browser.tabs.create({
        url: `https://github.com/helloyanis/media-downloader-unleashed/blob/master/src/installed.md#thank-you-for-installing-the-file-downloader-unleashed-add-on`,
    });
});

browser.runtime.setUninstallURL(`https://github.com/helloyanis/media-downloader-unleashed/blob/master/src/uninstalled.md`);
