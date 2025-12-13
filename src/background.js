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

// ----- extension lists for url-detection -----
const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];

const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions);
// build a safe regex from extensions (escape dots already present)
const extPattern = allExtensions.map(e => e.replace(/^\./, '').replace(/\+/g, '\\+')).join('|');
const detectionRegex = new RegExp('\\.(?:' + extPattern + ')(?:[?#].*)?$', 'i');

// helper to interpret setting values (localStorage or browser.storage.local)
function isFlagEnabled(val) {
    return val === '1' || val === 1 || val === true || val === 'true';
}

// get local settings: try localStorage first, fallback to browser.storage.local
function getSettings(callback) {
    try {
        // try localStorage (string values)
        const mimeVal = (typeof localStorage !== 'undefined') ? localStorage.getItem('mime-detection') : null;
        const urlVal = (typeof localStorage !== 'undefined') ? localStorage.getItem('url-detection') : null;

        if (mimeVal !== null || urlVal !== null) {
            callback({
                mimeDetection: isFlagEnabled(mimeVal),
                urlDetection: isFlagEnabled(urlVal)
            });
            return;
        }
    } catch (e) {
        // localStorage not available in this context -> fallback
    }

    // fallback to browser.storage.local
    browser.storage.local.get(['mime-detection', 'url-detection'], function (result) {
        callback({
            mimeDetection: isFlagEnabled(result['mime-detection']),
            urlDetection: isFlagEnabled(result['url-detection'])
        });
    });
}

function initListener() {
    // Decide which urls we will watch for onSendHeaders/onHeadersReceived - keep default <all_urls>
    urlList = ["<all_urls>"];

    // Read settings and then attach listeners accordingly
    getSettings(function (settings) {
        const mimeEnabled = !!settings.mimeDetection;
        const urlEnabled = !!settings.urlDetection;

        console.log('initListener settings: mimeEnabled=', mimeEnabled, 'urlEnabled=', urlEnabled);

        // Remove existing listeners if present
        if (headersSentListener) {
            try { browser.webRequest.onSendHeaders.removeListener(headersSentListener); } catch (e) { /* ignore */ }
        }
        if (headersReceivedListener) {
            try { browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener); } catch (e) { /* ignore */ }
        }

        // onSendHeaders: decide whether to record the request immediately (URL-based or all)
        headersSentListener = function (details) {
            try {
                const urlMatches = detectionRegex.test(details.url);

                // If neither flag is enabled -> save all (original behavior)
                if (!mimeEnabled && !urlEnabled) {
                    // Save as before
                } else {
                    // If url-detection enabled and URL matches -> save
                    if (!urlEnabled || (urlEnabled && !urlMatches)) {
                        // If url-detection enabled but URL doesn't match, and mime-detection is enabled,
                        // then we should NOT save now (wait for onHeadersReceived). So skip saving here.
                        if (urlEnabled && mimeEnabled && !urlMatches) {
                            // wait for onHeadersReceived to decide
                            return;
                        }
                        // If only mime detection is enabled -> do not save here
                        if (mimeEnabled && !urlEnabled) {
                            return;
                        }
                        // If urlEnabled is true and urlMatches is true -> fallthrough to save
                        // Otherwise, if logic reaches here but conditions didn't match, skip
                    }
                }

                // At this point either:
                // - neither flag set (=> save all), or
                // - urlEnabled && urlMatches (=> save), or
                // - both enabled and urlMatches (=> save)
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

                    // push the new request
                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                    console.log('Media request intercepted (onSendHeaders):', mediaRequest);
                });
            } catch (e) {
                console.error("Error in onSendHeaders handler:", e);
            }
        };

        browser.webRequest.onSendHeaders.addListener(
            headersSentListener,
            { urls: urlList },
            ['requestHeaders']
        );

        // onHeadersReceived: used to update size/responseHeaders and also to save requests when mime-detection triggers
        headersReceivedListener = async function (details) {
            try {
                // Extract content-length and content-type (if present)
                const responseHeaders = details.responseHeaders || [];
                let mediaSizeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-length');
                let size = mediaSizeHeader ? mediaSizeHeader.value : 'unknown';

                let contentTypeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-type');
                let contentType = contentTypeHeader ? (contentTypeHeader.value || '').toLowerCase() : '';

                // Normalize contentType (strip parameters)
                if (contentType.indexOf(';') !== -1) {
                    contentType = contentType.split(';')[0].trim();
                }

                const mimeMatches = (
                    contentType.startsWith('audio/') ||
                    contentType.startsWith('video/') ||
                    contentType === 'application/vnd.apple.mpegurl' ||
                    contentType === 'application/x-mpegurl' ||
                    contentType === 'application/dash+xml'
                );

                const urlMatches = detectionRegex.test(details.url);

                // Retrieve existing stored requests for this URL (if any)
                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

                    // Try to find a previously created request to update it
                    let updated = false;
                    for (let request of existingRequests) {
                        // If the request has no size / responseHeaders yet, update it
                        if (!request.size && (!request.responseHeaders || request.responseHeaders === null)) {
                            request.size = size;
                            request.responseHeaders = responseHeaders;
                            request.timeStamp = details.timeStamp;
                            updated = true;
                            break;
                        }
                    }

                    // Decide whether to add a new request entry in cases where onSendHeaders did not add one:
                    // - If neither flag set -> onSendHeaders already added, so we should have updated above.
                    // - If mime-detection only and mimeMatches -> add new entry here
                    // - If both enabled and neither matched onSendHeaders but mimeMatches now -> add
                    // - If url-detection only, we would have saved at onSendHeaders; no need to add here.
                    // So add if:
                    // (mimeEnabled && mimeMatches) OR (urlEnabled && urlMatches AND no existing request present)
                    // but guard against duplicates: only push if `updated` is false AND the saving condition matches.

                    getSettings(function (currentSettings) {
                        const mimeEnabledNow = !!currentSettings.mimeDetection;
                        const urlEnabledNow = !!currentSettings.urlDetection;

                        const shouldSaveNow = (() => {
                            if (!mimeEnabledNow && !urlEnabledNow) {
                                return true; // save all
                            }
                            if (mimeEnabledNow && mimeMatches) return true;
                            if (urlEnabledNow && urlMatches) return true;
                            return false;
                        })();

                        if (!updated && shouldSaveNow) {
                            // No prior entry to update -> create a new record using available info
                            let mediaRequest = {
                                url: details.url,
                                method: details.method || 'GET',
                                requestHeaders: null,
                                responseHeaders: responseHeaders,
                                size: size,
                                timeStamp: details.timeStamp
                            };
                            existingRequests.push(mediaRequest);
                            console.log('Media request added (onHeadersReceived):', mediaRequest);
                        } else if (updated) {
                            console.log('Media response updated (onHeadersReceived) for', details.url, 'size:', size);
                        } else {
                            // Not saving this request (didn't meet detection criteria)
                            // Nothing to do.
                        }

                        let requestsObj = {};
                        requestsObj[details.url] = existingRequests;
                        browser.storage.session.set(requestsObj);
                    });
                });
            } catch (e) {
                console.error("Error in onHeadersReceived handler:", e);
            }
        };

        browser.webRequest.onHeadersReceived.addListener(
            headersReceivedListener,
            { urls: urlList },
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
    if (details.reason === 'install') {
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

                        // Only cache if we actually received data
                        if (blob.size > 0) {
                            // store in indexeddb (background context)
                            await storeInCache(details.url, blob, '');

                            // debug
                            console.log("Cached response for:", details.url, "mime:", "", "bytes:", blob.size);
                        } else {
                            console.warn("Skipping cache for empty response:", details.url);
                        }
                    } catch (e) {
                        console.error("Failed to cache response body for", details.url, e);
                    }
                };
                filter.onerror = (err) => {
                    try { filter.disconnect(); } catch (e) { }
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
