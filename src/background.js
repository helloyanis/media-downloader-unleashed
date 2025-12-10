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

const urlMediaRegex = /\.(mp4|m3u8|ts|mp3|aac|wav|flv|webm|mkv|mov|m4a|m4v)(?:[?#].*)?$/i;
let urlList = [];
let headersSentListener, headersReceivedListener;

// ---------- IndexedDB helpers (same DB used by offlineStreamConvert.js) ----------
const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = (event) => reject(event.target.error || "IDB Open Error");
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

async function storeInCache(url, blob, mime) {
    try {
        const db = await openCacheDB();
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const item = {
            url: url,
            mime: mime || (blob && blob.type) || "application/octet-stream",
            data: blob,
            timestamp: Date.now()
        };
        return await new Promise((resolve, reject) => {
            const req = store.put(item);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to store in cache:", e);
    }
}
// -------------------------------------------------------------------------------

function initListener() {
    browser.storage.local.get('url-detection', function (result) {
        urlList = ["<all_urls>"];
        

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
                    size: null, // Placeholder for media size,
                    timeStamp: null // Placeholder for timestamp
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
                            request.timeStamp = details.timeStamp
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

browser.runtime.onInstalled.addListener((details) => {
    if( details.reason === 'install') {
        browser.tabs.create({
            url: `https://github.com/helloyanis/media-downloader-unleashed/blob/master/src/installed.md#thank-you-for-installing-the-file-downloader-unleashed-add-on`,
        });
    }
});

browser.runtime.onStartup.addListener(initListener);


browser.runtime.setUninstallURL(`https://forms.gle/Q5j2147qNkJnftU19`);

// ----------------- New: capture & cache media response bodies -----------------
// We use onHeadersReceived to detect Content-Type, and if it's a media type we attach
// a filterResponseData stream to capture the response body and store it into IndexedDB.
//
// NOTE: this requires the "webRequestFilterResponse" permission (you already have it).
// ------------------------------------------------------------------------------

let cacheHeadersListener;
function initCacheListener() {
    // remove if previously attached
    if (cacheHeadersListener) {
        try { browser.webRequest.onHeadersReceived.removeListener(cacheHeadersListener); } catch (e) { /* ignore */ }
    }

    cacheHeadersListener = browser.webRequest.onBeforeRequest.addListener(
        (details) => {
            try {
                // Find content-type header (if any)


                // decide if this is a media type we want to cache
                console.log("Cache listener checking:", details.url, "details", details);
                const shouldCache = (() => {
                    // Check URL pattern
                    if (urlMediaRegex.test(details.url)) {
                        return true;
                    }
                    return false;
                })();

                if (!shouldCache) return;

                // guard: filterResponseData may not exist in some environments
                if (!browser.webRequest.filterResponseData) {
                    console.warn("filterResponseData not available in this runtime; cannot cache response bodies.");
                    return;
                }

                // attach a filter to stream & capture the response body
                let filter;
                try {
                    filter = browser.webRequest.filterResponseData(details.requestId);
                } catch (e) {
                    console.warn("filterResponseData failed for requestId", details.requestId, e);
                    return;
                }

                const chunks = [];
                filter.ondata = (event) => {
                    // event.data is ArrayBuffer
                    try {
                        // store chunk for cache and pass it through to the response
                        chunks.push(event.data);
                        filter.write(event.data);
                        console.log("Caching chunk for:", details.url, "bytes:", event.data.byteLength);
                    } catch (e) {
                        console.error("Error writing chunk back to filter:", e);
                    }
                };
                filter.onstop = async () => {
                    try {
                        filter.disconnect();
                        // create a blob from the chunks
                        const blob = new Blob(chunks, { type: 'application/octet-stream' });

                        // store in indexeddb (background context)
                        await storeInCache(details.url, blob, '');

                        // debug
                        console.log("Cached response for:", details.url, "mime:", "", "bytes:", blob.size);
                    } catch (e) {
                        console.error("Failed to cache response body for", details.url, e);
                    }
                };
                filter.onerror = (err) => {
                    try { filter.disconnect(); } catch (e) {}
                    console.error("filter error:", err);
                };
            } catch (e) {
                console.error("Error in cache listener:", e);
            }
        },
        { urls: ["<all_urls>"] },
        ["blocking"]
    );
}

// initialize cache listener
initCacheListener();

browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'initCacheListener') {
        initCacheListener();
    }
});
