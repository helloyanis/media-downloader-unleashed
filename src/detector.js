/*
Copyright © 2026 🦊 helloyanis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Description: This file contains the code to intercept media requests and responses and store them in session storage.
// The code is executed in the background script of the extension.

// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}

let urlList = ["<all_urls>"];
let headersSentListener, headersReceivedListener;

// ---------- IndexedDB helpers ----------
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

function getContentType(headers) {
    if (!Array.isArray(headers)) return "";
    const header = headers.find(h => h && h.name && h.name.toLowerCase() === "content-type");
    return (header?.value || "").split(";")[0].trim().toLowerCase();
}

function replaceContentTypeHeader(headers, mime) {
    const updated = Array.isArray(headers) ? headers.map(h => ({ ...h })) : [];
    const index = updated.findIndex(
        h => h && h.name && h.name.toLowerCase() === "content-type"
    );

    if (index >= 0) {
        updated[index] = { ...updated[index], value: mime };
    } else {
        updated.push({ name: "Content-Type", value: mime });
    }
    return updated;
}

function isMediaContentType(contentType) {
    const type = (contentType || "").split(";")[0].trim().toLowerCase();

    return (
        type.startsWith("audio/") ||
        type.startsWith("video/") ||
        type === "application/vnd.apple.mpegurl" ||
        type === "application/x-mpegurl" ||
        type === "application/dash+xml" ||
        type === "application/x-matroska" ||
        type === "application/octet-stream" ||
        type === "text/vtt" ||
        type === "application/ttml+xml" ||
        type === "application/x-subrip" ||
        type === "application/x-srt"
    );
}

// Inspect only the beginning of a text response. A generic text/plain response
// is not a media response unless its contents have a recognizable media format.
async function detectPlainTextMediaMime(blob) {
    if (!(blob instanceof Blob) || blob.size === 0) return null;

    const sample = await blob.slice(0, 256 * 1024).text();
    const text = sample.replace(/^\uFEFF/, "").trimStart();

    // Require the actual HLS header, not merely an incidental #EXTINF string.
    if (/^#EXTM3U(?:\s|$)/i.test(text)) {
        return "application/vnd.apple.mpegurl";
    }

    // Permit an XML declaration and comments before the DASH MPD root element.
    if (/^(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD(?:\s|>)/i.test(text)) {
        return "application/dash+xml";
    }

    if (/^WEBVTT(?:[ \t].*)?(?:\r?\n|$)/i.test(text)) {
        return "text/vtt";
    }

    return null;
}

async function storeInCache(url, blob, headers, status) {
    console.debug("Storing in cache:", url, "status:", status, "headers:", headers);
    try {
        const db = await openCacheDB();

        const cachedItem = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const req = tx.objectStore(STORE_NAME).get(url);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        // Headers are always stored as an array.
        const safeHeaders = Array.isArray(headers)
            ? headers
            : (Array.isArray(cachedItem?.headers) ? cachedItem.headers : []);

        const item = {
            url,
            headers: safeHeaders,
            status: status ?? cachedItem?.status ?? "000",
            data: blob || cachedItem?.data || null,
            mime: getContentType(safeHeaders) || cachedItem?.mime || "",
            timestamp: cachedItem?.timestamp || Date.now()
        };

        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const req = tx.objectStore(STORE_NAME).put(item);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("Failed to store in cache:", e);
    }
}

// Kept for callers that only need to merge headers into an existing cache row.
// It no longer creates a header-only row that can race with body validation.
async function addHeadersToCache(url, headers, status) {
    try {
        const db = await openCacheDB();
        const cachedItem = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const req = tx.objectStore(STORE_NAME).get(url);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!cachedItem?.data) {
            console.debug("Deferring cache headers until response body is available:", url);
            return;
        }

        await storeInCache(url, cachedItem.data, headers, status);
    } catch (e) {
        console.error("Failed to add response headers to cache:", e);
    }
}

async function getResponseHeadersFromCache(url) {
    try {
        const db = await openCacheDB();

        return await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);

            req.onsuccess = () => resolve(req.result?.headers || []);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to get response headers from cache:", e);
        return [];
    }
}

async function removeFromCache(url) {
    try {
        const db = await openCacheDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(url);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to remove from cache:", e);
    }
}
// -------------------------------------------------------------------------------

// ----- extension lists for url-detection -----
const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
const subtitleExtensions = [".srt", ".vtt", ".sub", ".ass", ".ssa", ".idx", ".ttml", ".dfxp"];

const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions);
// build a safe regex from extensions (escape dots already present)
const extPattern = allExtensions.map(e => e.replace(/^\./, '').replace(/\+/g, '\\+')).join('|');
const detectionRegex = new RegExp('\\.(?:' + extPattern + ')(?:[?#].*)?$', 'i');
const temporaryHeaderMap = new Map();
const temporaryRequestBodyMap = new Map();
const temporaryCookieMap = new Map();

// Latest response metadata for each webRequest requestId. Redirect responses may
// reuse an ID; the final response headers overwrite the redirect metadata.
// Response headers and bodies can arrive in either order.
const temporaryResponseMetaMap = new Map();
const pendingResponseBodies = new Map();

const detectedMimeByRequestId = new Map();

// Use requestId + URL to keep redirect hops separate.
function getResponseKey(requestId, url) {
    return `${requestId}\u0000${url}`;
}

async function removeSessionRequest(url, requestId) {
    try {
        const result = await browser.storage.session.get(url);
        const requests = Array.isArray(result[url]) ? result[url] : [];
        const remaining = requests.filter(request => request.requestId !== requestId);

        if (remaining.length === requests.length) return;
        if (remaining.length) {
            await browser.storage.session.set({ [url]: remaining });
        } else {
            await browser.storage.session.remove(url);
        }
    } catch (e) {
        console.warn("Failed to remove rejected text response from session storage:", url, e);
    }
}

async function updateSessionResponseHeaders(url, requestId, headers, mime) {
    try {
        const result = await browser.storage.session.get(url);
        const requests = Array.isArray(result[url]) ? result[url] : [];
        let changed = false;

        const updated = requests.map(request => {
            if (request.requestId !== requestId) return request;
            changed = true;
            return {
                ...request,
                responseHeaders: headers,
                mime,
                contentType: mime
            };
        });

        if (changed) {
            await browser.storage.session.set({ [url]: updated });
        }
        return changed;
    } catch (e) {
        console.warn("Failed to update detected MIME in session storage:", url, e);
        return false;
    }
}


// Add a text/plain response to the media list only after its body
// has been positively identified as HLS, DASH, or WebVTT.
async function upsertSniffedTextMediaRequest(
    responseMeta,
    requestId,
    headers,
    mime,
    blob
) {
    const url = responseMeta.url;

    try {
        const result = await browser.storage.session.get(url);
        const requests = Array.isArray(result[url])
            ? [...result[url]]
            : [];

        const index = requests.findIndex(
            item => item.requestId === requestId
        );

        const existing = index >= 0 ? requests[index] : null;

        const settings = await new Promise(resolve =>
            getSettings(resolve)
        );

        let urlMatches = false;

        try {
            urlMatches = detectionRegex.test(decodeURI(url));
        } catch (_) {
            urlMatches = detectionRegex.test(url);
        }

        // MIME detection admits a positively sniffed manifest.
        // URL detection preserves the existing URL-based behavior.
        const shouldAdd =
            !!existing ||
            settings.mimeDetection ||
            (settings.urlDetection && urlMatches) ||
            (!settings.mimeDetection && !settings.urlDetection);

        if (!shouldAdd) {
            return false;
        }

        let name = existing?.name || null;

        if (!name && browser.tabs && responseMeta.tabId !== -1) {
            try {
                name = (
                    await browser.tabs.get(responseMeta.tabId)
                ).title;
            } catch (e) {
                console.debug(
                    "Could not read tab title for sniffed media request:",
                    requestId,
                    e
                );
            }
        }

        const contentLength = headers.find(h =>
            h && h.name &&
            h.name.toLowerCase() === "content-length"
        )?.value;

        const entry = {
            ...(existing || {}),
            requestId,
            url,
            name,
            method: responseMeta.method || existing?.method || "GET",

            requestHeaders:
                temporaryHeaderMap.get(requestId) ||
                existing?.requestHeaders ||
                null,

            responseHeaders: headers,

            requestBody:
                temporaryRequestBodyMap.get(requestId) ||
                existing?.requestBody ||
                null,

            cookie:
                temporaryCookieMap.get(url) ||
                existing?.cookie ||
                "",

            size: contentLength || String(blob.size),

            timeStamp:
                responseMeta.timeStamp ||
                existing?.timeStamp ||
                Date.now(),

            tabId:
                responseMeta.tabId ??
                existing?.tabId ??
                -1,

            mime,
            contentType: mime
        };

        if (index >= 0) {
            requests[index] = entry;
        } else {
            requests.push(entry);
        }

        await browser.storage.session.set({
            [url]: requests
        });

        console.debug(
            "Added verified text media request:",
            url,
            "mime:",
            mime
        );

        try {
            recordParamDiff(url);
        } catch (e) {
            console.debug(
                "recordParamDiff failed after text sniff",
                e
            );
        }

        return true;

    } catch (e) {
        console.error(
            "Failed to add sniffed text media request:",
            url,
            e
        );

        return false;
    }
}


// Helper: directory key for grouping segment URLs (origin + directory path)
function getDirKeyFromUrl(urlString) {
    try {
        const u = new URL(urlString);
        return u.origin + u.pathname.substring(0, u.pathname.lastIndexOf('/') + 1);
    } catch (e) {
        return urlString.split('?')[0];
    }
}

// Record differences in query parameters for URLs in the same directory.
function recordParamDiff(urlString) {
    try {
        const u = new URL(urlString);
        const dirKey = getDirKeyFromUrl(urlString);
        const keys = Array.from(u.searchParams.keys());

        browser.storage.session.get('segmentParamOverrides', function (res) {
            const map = res.segmentParamOverrides || {};
            const existing = map[dirKey] || { observedParams: [], extraParams: {}, lastSeen: Date.now(), example: '' };
            const existingSet = new Set(existing.observedParams || []);

            const newExtra = {};
            let added = false;
            for (const k of keys) {
                if (!existingSet.has(k)) {
                    newExtra[k] = u.searchParams.get(k);
                    added = true;
                }
            }

            if (added) {
                existing.observedParams = Array.from(new Set((existing.observedParams || []).concat(keys)));
                existing.extraParams = Object.assign(existing.extraParams || {}, newExtra);
                existing.lastSeen = Date.now();
                existing.example = existing.example || urlString;
                map[dirKey] = existing;
                browser.storage.session.set({ segmentParamOverrides: map }, function () {
                    console.log('Detected extra query params for', dirKey, 'added', newExtra);
                });
            } else if (!existing.observedParams || existing.observedParams.length === 0) {
                existing.observedParams = keys;
                existing.lastSeen = Date.now();
                existing.example = existing.example || urlString;
                map[dirKey] = existing;
                browser.storage.session.set({ segmentParamOverrides: map });
            }
        });
    } catch (e) {
        console.error('recordParamDiff error', e);
    }
}

// helper to interpret setting values
function isFlagEnabled(val) {
    return val === '1' || val === 1 || val === true || val === 'true';
}

// get local settings
function getSettings(callback) {
    browser.storage.local.get(['mime-detection', 'url-detection', 'media-cache', 'media-cache-private'], function (result) {
        if (!result) result = {};
        const mimeRaw = Object.prototype.hasOwnProperty.call(result, 'mime-detection') ? result['mime-detection'] : '1';
        const urlRaw = Object.prototype.hasOwnProperty.call(result, 'url-detection') ? result['url-detection'] : '1';
        const mediaCache = Object.prototype.hasOwnProperty.call(result, 'media-cache') ? result['media-cache'] : '1';
        const mediaCachePrivate = Object.prototype.hasOwnProperty.call(result, 'media-cache-private') ? result['media-cache-private'] : '0';
        callback({
            mimeDetection: isFlagEnabled(mimeRaw),
            urlDetection: isFlagEnabled(urlRaw),
            mediaCache: isFlagEnabled(mediaCache),
            mediaCachePrivate: isFlagEnabled(mediaCachePrivate)
        });
    });
}

// Helper: convert ArrayBuffer to base64 safely in chunks
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

let beforeRequestListener, beforeSendHeadersListener;

function initListener() {
    // Clear indexedDB cache on init to avoid stale data
    openCacheDB().then(db => {
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
    }).catch(e => {
        console.error("Failed to clear IndexedDB cache on init:", e);
    });

    getSettings(function (settings) {
        const mimeEnabled = !!settings.mimeDetection;
        const urlEnabled = !!settings.urlDetection;
        const mediaCacheEnabled = !!settings.mediaCache;
        const mediaCachePrivateEnabled = !!settings.mediaCachePrivate;

        console.log('initListener settings: mimeEnabled=', mimeEnabled, 'urlEnabled=', urlEnabled);

        if (headersSentListener) {
            try { browser.webRequest.onSendHeaders.removeListener(headersSentListener); } catch (e) { }
        }
        if (beforeSendHeadersListener) {
            try { browser.webRequest.onBeforeSendHeaders.removeListener(beforeSendHeadersListener); } catch (e) { }
        }
        if (headersReceivedListener) {
            try { browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener); } catch (e) { }
        }
        if (beforeRequestListener) {
            try { browser.webRequest.onBeforeRequest.removeListener(beforeRequestListener); } catch (e) { }
            beforeRequestListener = null;
        }

        beforeRequestListener = function (details) {
            try {
                if (!details || !details.requestBody) return;
                const protocol = new URL(details.originUrl || details.url).protocol;
                if (protocol === 'moz-extension:' || protocol === 'chrome-extension:') {
                    return;
                }

                const rb = details.requestBody;

                if (rb.formData) {
                    temporaryRequestBodyMap.set(details.requestId, { type: 'formData', data: rb.formData });
                } else if (rb.raw && rb.raw.length) {
                    try {
                        let totalLen = 0;
                        for (let part of rb.raw) {
                            if (part && part.bytes) {
                                totalLen += part.bytes.byteLength || part.bytes.length || 0;
                            }
                        }
                        if (totalLen === 0) return;

                        const combined = new Uint8Array(totalLen);
                        let offset = 0;
                        for (let part of rb.raw) {
                            if (!part || !part.bytes) continue;
                            const src = new Uint8Array(part.bytes);
                            combined.set(src, offset);
                            offset += src.length;
                        }
                        const base64 = arrayBufferToBase64(combined.buffer);
                        temporaryRequestBodyMap.set(details.requestId, { type: 'base64', data: base64 });
                    } catch (e) {
                        console.warn("Failed to serialize raw request body for requestId", details.requestId, e);
                    }
                }
            } catch (e) {
                console.error("Error in onBeforeRequest listener (requestBody capture):", e);
            }
        };

        try {
            if (browser.webRequest && browser.webRequest.onBeforeRequest && !browser.webRequest.onBeforeRequest.hasListener(beforeRequestListener)) {
                browser.webRequest.onBeforeRequest.addListener(
                    beforeRequestListener,
                    { urls: urlList },
                    ['requestBody']
                );
            }
        } catch (e) {
            console.warn("Failed to attach onBeforeRequest requestBody listener:", e);
        }

        beforeSendHeadersListener = async function (details) {
            console.log("BSEND");
            const protocol = new URL(details.originUrl || details.url).protocol;
            if (protocol === 'moz-extension:' || protocol === 'chrome-extension:') {
                try {
                    const cookie = await browser.storage.session.get(details.url).then(result => {
                        return result[details.url]?.[0]?.cookie || '';
                    });
                    if (cookie) {
                        if (!details.requestHeaders.some(h => h.name.toLowerCase() === 'cookie')) {
                            details.requestHeaders.push({ name: 'Cookie', value: cookie });
                        } else {
                            details.requestHeaders = details.requestHeaders.map(h => {
                                if (h.name.toLowerCase() === 'cookie') {
                                    return { name: 'Cookie', value: cookie };
                                }
                                return h;
                            });
                        }
                        console.debug("Added Cookie header to extension request:", cookie);
                    }
                } catch (e) {
                    console.error("Error adding Cookie header to extension request:", e);
                }
            } else {
                console.debug("Details:", details);

                const cookie = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie')?.value || '';
                if (cookie) {
                    console.debug("Saving request cookie :", cookie);
                }

                temporaryCookieMap.set(details.url, cookie);
            }
            return { requestHeaders: details.requestHeaders };
        };

        browser.webRequest.onBeforeSendHeaders.addListener(
            beforeSendHeadersListener,
            { urls: urlList },
            ['requestHeaders', 'blocking']
        );
        console.log("Attached onBeforeSendHeaders listener.");

        headersSentListener = async function (details) {
            console.log("HSENT");
            const protocol = new URL(details.originUrl || details.url).protocol;
            if (protocol === 'moz-extension:' || protocol === 'chrome-extension:') {
                return;
            }
            try {
                if (details.requestHeaders) {
                    temporaryHeaderMap.set(details.requestId, details.requestHeaders);
                }

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                if (!mimeEnabled && !urlEnabled) {
                    // Save all requests (original behavior).
                } else {
                    if (!urlEnabled || (urlEnabled && !urlMatches)) {
                        if (urlEnabled && mimeEnabled && !urlMatches) {
                            return;
                        }
                        if (mimeEnabled && !urlEnabled) {
                            return;
                        }
                    }
                }

                const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;

                let mediaRequest = {
                    requestId: details.requestId,
                    url: details.url,
                    name: browser.tabs && details.tabId !== -1 ? (await browser.tabs.get(details.tabId)).title : null,
                    method: details.method,
                    requestHeaders: details.requestHeaders,
                    responseHeaders: null,
                    requestBody: cachedBody,
                    cookie: temporaryCookieMap.get(details.url) || '',
                    size: null,
                    timeStamp: null,
                    tabId: details.tabId
                };

                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = result[details.url] || [];

                    if (existingRequests.length > 1000) {
                        const oldestRequest = existingRequests.shift();
                        temporaryRequestBodyMap.delete(oldestRequest.requestId);
                        temporaryHeaderMap.delete(oldestRequest.requestId);
                        temporaryCookieMap.delete(oldestRequest.requestId);
                        removeFromCache(oldestRequest.url).catch(e => {
                            console.error("Failed to remove from cache for oldest request:", oldestRequest.url, e);
                        });
                        console.warn("Removed oldest request to maintain limit of 1000 for", details.url);
                    }

                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                    console.log('Media request intercepted (onSendHeaders):', mediaRequest);
                    try { recordParamDiff(details.url); } catch (e) { console.debug('recordParamDiff failed (onSendHeaders)', e); }
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

        // onHeadersReceived: update size/responseHeaders and save requests
        // when mime-detection triggers.
        headersReceivedListener = async function (details) {
            const protocol = new URL(details.originUrl || details.url).protocol;
            if (protocol === 'moz-extension:' || protocol === 'chrome-extension:') {
                return;
            }

            try {
                let responseHeaders = details.responseHeaders || [];
                let mediaSizeHeader = responseHeaders.find(header =>
                    header.name && header.name.toLowerCase() === 'content-length'
                );
                let size = mediaSizeHeader ? mediaSizeHeader.value : 'unknown';

                let contentTypeHeader = responseHeaders.find(header =>
                    header.name && header.name.toLowerCase() === 'content-type'
                );
                let contentType = contentTypeHeader
                    ? (contentTypeHeader.value || '').toLowerCase()
                    : '';

                if (contentType.indexOf(';') !== -1) {
                    contentType = contentType.split(';')[0].trim().toLowerCase();
                }


                const responseMeta = {
                    url: details.url,
                    responseHeaders: responseHeaders,
                    statusCode: details.statusCode,
                    contentType: contentType,
                    timeStamp: details.timeStamp,
                    method: details.method || 'GET',
                    tabId: details.tabId,
                    incognito: details.incognito
                };

                const responseKey = getResponseKey(
                    details.requestId,
                    details.url
                );

                temporaryResponseMetaMap.set(responseKey, responseMeta);

                // The body might already have arrived.
                // Try processing it now.
                void processPendingCapturedResponse(
                    details.requestId,
                    details.url
                );

                // Redirects are not media resources.
                // Wait for Firefox to report the final response.
                if (
                    details.statusCode >= 300 &&
                    details.statusCode < 400 &&
                    details.statusCode !== 304
                ) {
                    console.debug(
                        "Ignoring redirect response for media list:",
                        details.url,
                        "status:",
                        details.statusCode
                    );

                    return;
                }

                // text/plain responses must be inspected before they
                // are allowed into the media list.
                if (contentType === 'text/plain') {
                    console.debug(
                        "Deferring text/plain response until body sniffing:",
                        details.url
                    );

                    return;
                }


                if (contentType === 'application/vnd.yt-ump') {
                    console.debug("Detected youtube video, adding placeholder entry for", details.url);
                    await browser.storage.session.set({
                        [details.url]: [{ contentType: contentType }]
                    });
                    return;
                }

                const mimeMatches = (
                    contentType.startsWith('audio/') ||
                    contentType.startsWith('video/') ||
                    contentType.includes('application/vnd.apple.mpegurl') ||
                    contentType.includes('application/x-mpegurl') ||
                    contentType.includes('application/dash+xml') ||
                    contentType.includes('application/x-matroska') ||
                    contentType.includes('application/octet-stream') ||
                    contentType.includes('text/vtt') ||
                    contentType.includes('application/ttml+xml') ||
                    contentType.includes('application/x-subrip') ||
                    contentType.includes('application/x-srt')
                );

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                browser.storage.session.get(details.url, async function (result) {
                    let existingRequests = result[details.url] || [];
                    const alreadySniffed = detectedMimeByRequestId.get(details.requestId);

                    if (alreadySniffed && alreadySniffed.url === details.url) {
                        responseHeaders = alreadySniffed.headers;
                        contentType = alreadySniffed.mime;
                    }

                    let updated = false;

                    const userSettings = await new Promise((resolve) => {
                        getSettings(resolve);
                    });

                    if (userSettings.mimeDetection && !mimeMatches) {
                        console.debug("Skipping cache for non-media MIME:", details.url);
                        browser.storage.session.remove(details.url);
                        removeFromCache(details.url).catch(e => {
                            console.error("Failed to remove from cache for non-media MIME:", details.url, e);
                        });
                        return;
                    }

                    for (let request of existingRequests) {
                        if (!request.size && (!request.responseHeaders || request.responseHeaders === null)) {
                            request.size = size;
                            request.responseHeaders = responseHeaders;
                            request.timeStamp = details.timeStamp;
                            updated = true;
                            break;
                        }
                    }

                    getSettings(async function (currentSettings) {
                        const sniffedMime = detectedMimeByRequestId.get(details.requestId);

                        if (sniffedMime && sniffedMime.url === details.url) {
                            responseHeaders = sniffedMime.headers;
                            contentType = sniffedMime.mime;

                            for (const request of existingRequests) {
                                if (request.requestId === details.requestId) {
                                    request.responseHeaders = responseHeaders;
                                    request.mime = contentType;
                                    request.contentType = contentType;
                                }
                            }
                        }

                        const mimeEnabledNow = !!currentSettings.mimeDetection;
                        const urlEnabledNow = !!currentSettings.urlDetection;

                        const shouldSaveNow = (() => {
                            if (!mimeEnabledNow && !urlEnabledNow) return true;
                            if (mimeEnabledNow && mimeMatches) return true;
                            if (urlEnabledNow && urlMatches) return true;
                            return false;
                        })();

                        if (!updated && shouldSaveNow) {
                            const cachedHeaders = temporaryHeaderMap.get(details.requestId) || null;
                            const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;

                            let requestName = null;
                            if (browser.tabs && details.tabId !== -1) {
                                try {
                                    requestName = (await browser.tabs.get(details.tabId)).title;
                                } catch (e) {
                                    console.debug("Could not read tab title for request:", details.requestId, e);
                                }
                            }

                            const latestSniffedMime = detectedMimeByRequestId.get(details.requestId);
                            if (latestSniffedMime && latestSniffedMime.url === details.url) {
                                responseHeaders = latestSniffedMime.headers;
                                contentType = latestSniffedMime.mime;
                            }

                            let mediaRequest = {
                                requestId: details.requestId,
                                url: details.url,
                                name: requestName,
                                method: details.method || 'GET',
                                requestHeaders: cachedHeaders,
                                responseHeaders: responseHeaders,
                                requestBody: cachedBody,
                                cookie: temporaryCookieMap.get(details.url) || '',
                                size: size,
                                timeStamp: details.timeStamp,
                                tabId: details.tabId
                            };

                            existingRequests.push(mediaRequest);
                            console.log('Media request added (onHeadersReceived):', mediaRequest);
                            try { recordParamDiff(details.url); } catch (e) { console.debug('recordParamDiff failed (onHeadersReceived)', e); }
                        } else if (updated) {
                            console.log('Media response updated (onHeadersReceived) for', details.url);
                        }

                        let requestsObj = {};
                        requestsObj[details.url] = existingRequests;
                        await browser.storage.session.set(requestsObj);

                        if (sniffedMime && sniffedMime.url === details.url) {
                            detectedMimeByRequestId.delete(details.requestId);
                        }
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

// Send media request data to the popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getMediaRequests') {
        browser.storage.session.get(null, function (items) {
            delete items['completedDownloads'];
            delete items['failedDownloads'];
            delete items['queuedAndroidDownloads'];
            delete items['pendingPopupState'];

            if (message.tabId !== undefined && message.tabId !== NaN) {
                const tabId = parseInt(message.tabId, 10);
                const tabMediaUrls = Object.keys(items).filter(url =>
                    Array.isArray(items[url]) && items[url].some(r => r.tabId === tabId)
                );
                const otherMediaUrls = Object.keys(items).filter(url =>
                    !tabMediaUrls.includes(url)
                );

                const sortedUrls = [...tabMediaUrls, ...otherMediaUrls];
                const sortedItems = {};
                for (const url of sortedUrls) {
                    sortedItems[url] = items[url];
                }
                sendResponse(sortedItems);
            } else {
                sendResponse(items);
            }
        });
        return true;
    }

    if (message && message.action === 'readCachedBodyText') {
        const url = message.url;
        openCacheDB().then(db => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(url);

            request.onsuccess = async function (event) {
                const cachedItem = event.target.result;

                if (!cachedItem?.data) {
                    sendResponse(null);
                    return;
                }

                try {
                    sendResponse(await cachedItem.data.text());
                } catch (e) {
                    console.error("Failed to decode cached body:", e);
                    sendResponse(null);
                }
            };

            request.onerror = function (event) {
                console.error("Failed to read from IndexedDB cache:", event.target.error);
                sendResponse(null);
            };
        }).catch(e => {
            console.error("Failed to open IndexedDB cache:", e);
            sendResponse(null);
        });

        return true;
    }

    if (message.action === 'clearStorage') {
        const ongoingDownloads = message.ongoingDownloads || [];
        const ongoingIDs = new Set(ongoingDownloads.map(d => d.requestId));
        const ongoingURLs = new Set(ongoingDownloads.map(d => d.url));

        browser.storage.session.get(null, function (items) {
            for (let url in items) {
                let requests = items[url];

                if (!Array.isArray(requests)) {
                    requests = [requests];
                }

                console.log(requests);
                const filteredRequests = requests.filter(r => ongoingIDs.has(r.requestId));

                if (filteredRequests.length > 0) {
                    let obj = {};
                    obj[url] = filteredRequests;
                    browser.storage.session.set(obj);
                } else {
                    browser.storage.session.remove(url);
                }
            }
        });

        openCacheDB().then(db => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.openCursor();

            request.onsuccess = function (event) {
                const cursor = event.target.result;
                if (cursor) {
                    if (!ongoingURLs.has(cursor.value.url)) {
                        store.delete(cursor.primaryKey);
                    }
                    cursor.continue();
                }
            };
        }).catch(e => {
            console.error("Failed to clear IndexedDB cache:", e);
        });
    }
});

// Initialize the listener
initListener();

browser.action.onClicked.addListener((tab) => {
    browser.storage.local.get('open-preference', async function (result) {
        console.log('Open preference:', result['open-preference']);

        if (result['open-preference'] === 'window') {
            browser.windows.create({
                url: browser.runtime.getURL(`popup.html?tabId=${tab.id}`),
                type: 'popup',
                width: 800,
                height: 600,
            });
        } else if (result['open-preference'] === 'floating') {
            await browser.action.setPopup({ popup: 'popup.html?tabId=' + tab.id });
            console.log(await browser.action.getPopup({}));
            await browser.action.openPopup();
            await browser.action.setPopup({ popup: null });
        } else {
            browser.tabs.create({
                url: browser.runtime.getURL(`popup.html?tabId=${tab.id}`),
            });
        }
    });
});

browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        browser.tabs.create({
            url: `https://github.com/helloyanis/media-downloader-unleashed/blob/master/src/installed.md#thank-you-for-installing-the-media-downloader-unleashed-add-on`,
        });
    }
});

browser.runtime.onStartup.addListener(initListener);

browser.runtime.setUninstallURL(`https://forms.gle/Q5j2147qNkJnftU19`);


// ----------------- Capture & cache media response bodies -----------------
// We use onHeadersReceived to detect Content-Type, and if it's a media type
// we attach a filterResponseData stream to capture the response body and store
// it into IndexedDB.
// ------------------------------------------------------------------------------

let cacheListener = null;
let mediaCacheEnabled = false;
let mediaCachePrivateEnabled = false;

// helper to safely remove current listener
function detachCacheListener() {
    if (!cacheListener) return;
    try {
        browser.webRequest.onBeforeRequest.removeListener(cacheListener);
    } catch (e) {
        // ignore if already removed
    }
    cacheListener = null;
    console.debug("Cache listener detached.");
}


async function processPendingCapturedResponse(requestId, url) {
    const key = getResponseKey(requestId, url);

    const captured = pendingResponseBodies.get(key);
    const responseMeta = temporaryResponseMetaMap.get(key);

    // Wait until BOTH the body and response headers exist.
    if (!captured || !responseMeta || captured.processing) {
        return;
    }

    captured.processing = true;

    const responseUrl = responseMeta.url || url;
    const statusCode = Number(responseMeta.statusCode || 0);

    try {
        // Never cache redirect responses.
        if (statusCode >= 300 && statusCode < 400) {
            console.debug(
                "Skipping cache for redirect response:",
                responseUrl,
                "status:",
                statusCode
            );
            return;
        }

        const blob = captured.blob;
        const totalSize = blob.size;

        if (totalSize === 0) {
            console.debug("Skipping empty response:", responseUrl);
            return;
        }

        if (totalSize > 2 * 1024 * 1024 * 1024) {
            console.warn("Skipping response larger than 2GB:", responseUrl);
            return;
        }

        // Preserve the existing Range request protection.
        const requestHeaders =
            temporaryHeaderMap.get(requestId) || [];

        const rangeHeader = requestHeaders.find(
            h => h && h.name &&
                h.name.toLowerCase() === "range"
        )?.value?.trim().toLowerCase() || null;

        if (
            rangeHeader &&
            rangeHeader !== "bytes=0-" &&
            rangeHeader !== `bytes=0-${totalSize - 1}`
        ) {
            console.debug(
                "Skipping partial response:",
                responseUrl
            );
            return;
        }

        const contentType =
            responseMeta.contentType ||
            getContentType(responseMeta.responseHeaders);

        let finalMime = contentType;

        let finalHeaders = Array.isArray(responseMeta.responseHeaders)
            ? responseMeta.responseHeaders
            : [];

        // --------------------------------------------------
        // TEXT/PLAIN SNIFFING
        // --------------------------------------------------

        if (contentType === "text/plain") {

            finalMime = await detectPlainTextMediaMime(blob);

            if (!finalMime) {
                console.debug(
                    "Skipping ordinary text/plain response:",
                    responseUrl
                );

                await removeFromCache(responseUrl);

                await removeSessionRequest(
                    responseUrl,
                    requestId
                );

                return;
            }

            // Update cached MIME metadata.
            finalHeaders = replaceContentTypeHeader(
                finalHeaders,
                finalMime
            );

            // Only now add the request to the media list.
            await upsertSniffedTextMediaRequest(
                responseMeta,
                requestId,
                finalHeaders,
                finalMime,
                blob
            );

            console.debug(
                "Detected text/plain media response:",
                responseUrl,
                "->",
                finalMime
            );

        } else {

            // --------------------------------------------------
            // NORMAL MEDIA MIME DETECTION
            // --------------------------------------------------

            let urlMatches = false;

            try {
                urlMatches = detectionRegex.test(
                    decodeURI(responseUrl)
                );
            } catch (_) {
                urlMatches = detectionRegex.test(responseUrl);
            }

            if (!isMediaContentType(contentType) && !urlMatches) {
                console.debug(
                    "Skipping cache for non-media response:",
                    responseUrl,
                    "content-type:",
                    contentType || "(missing)"
                );

                return;
            }
        }

        // --------------------------------------------------
        // CACHE RESPONSE BODY
        // --------------------------------------------------

        const isIncognito = !!responseMeta.incognito;

        const shouldCache =
            (mediaCacheEnabled && !isIncognito) ||
            (mediaCachePrivateEnabled && isIncognito);

        if (!shouldCache) {
            console.debug(
                "Skipping body cache because media-cache is disabled:",
                responseUrl
            );
            return;
        }

        const storedBlob = new Blob([blob], {
            type: finalMime || "application/octet-stream"
        });

        await storeInCache(
            responseUrl,
            storedBlob,
            finalHeaders,
            statusCode
        );

        console.log(
            "Cached media response for:",
            responseUrl,
            "bytes:",
            storedBlob.size,
            "mime:",
            finalMime || "(not supplied)"
        );

    } catch (e) {
        console.error(
            "Failed to classify/cache response body:",
            responseUrl,
            e
        );

    } finally {

        // Delete only the exact entries we processed.
        if (pendingResponseBodies.get(key) === captured) {
            pendingResponseBodies.delete(key);
        }

        if (temporaryResponseMetaMap.get(key) === responseMeta) {
            temporaryResponseMetaMap.delete(key);
        }
    }
}

// attach listener
function attachCacheListener() {
    if (cacheListener) return;

    // guard: if runtime doesn't support filterResponseData, don't attach
    if (!browser.webRequest || !browser.webRequest.filterResponseData) {
        console.warn("filterResponseData not available; not attaching cache listener.");
        return;
    }

    cacheListener = (details) => {
        try {
            let filter;

            try {
                filter = browser.webRequest.filterResponseData(details.requestId);
            } catch (e) {
                console.warn("filterResponseData failed for requestId", details.requestId, e);
                return;
            }

            const chunks = [];

            filter.ondata = (event) => {
                try {
                    chunks.push(event.data);
                    filter.write(event.data);
                } catch (e) {
                    console.error("Error writing chunk back to filter:", e);
                }
            };


            filter.onstop = async () => {
                try {
                    filter.disconnect();

                    const blob = new Blob(chunks);

                    const key = getResponseKey(
                        details.requestId,
                        details.url
                    );

                    const captured = {
                        url: details.url,
                        blob: blob,
                        capturedAt: Date.now(),
                        processing: false
                    };

                    // Keep the captured body until its response metadata arrives.
                    pendingResponseBodies.set(key, captured);

                    if (!temporaryResponseMetaMap.has(key)) {
                        console.debug(
                            "Response body captured; waiting for response headers:",
                            details.url
                        );
                    }

                    // This processes immediately if headers have already arrived.
                    // Otherwise, onHeadersReceived will trigger it later.
                    await processPendingCapturedResponse(
                        details.requestId,
                        details.url
                    );

                    // Cleanup in case response headers never arrive.
                    setTimeout(() => {
                        if (pendingResponseBodies.get(key) === captured) {
                            pendingResponseBodies.delete(key);
                            temporaryResponseMetaMap.delete(key);

                            console.debug(
                                "Discarding response body that never received headers:",
                                details.url
                            );
                        }
                    }, 60000);

                } catch (e) {
                    console.error(
                        "Failed to capture response body:",
                        details.url,
                        e
                    );
                }
            };


            filter.onerror = (err) => {
                try {
                    filter.disconnect();
                } catch (e) { }

                const key = getResponseKey(
                    details.requestId,
                    details.url
                );

                pendingResponseBodies.delete(key);
                temporaryResponseMetaMap.delete(key);

                console.error(
                    `Filter error for request ${details.requestId}`,
                    err
                );
            };
        } catch (e) {
            console.error("Error in cache listener:", e);
        }
    };

    browser.webRequest.onBeforeRequest.addListener(
        cacheListener,
        { urls: ["<all_urls>"] },
        ["blocking"]
    );

    console.debug("Cache listener attached.");
}

// read initial setting from storage and attach/detach accordingly
async function initCacheState() {
    try {
        const resCache = await browser.storage.local.get('media-cache');
        const enabled = !!isFlagEnabled(resCache['media-cache']);
        mediaCacheEnabled = enabled;

        const resCachePrivate = await browser.storage.local.get('media-cache-private');
        const enabledPrivate = !!isFlagEnabled(resCachePrivate['media-cache-private']);
        mediaCachePrivateEnabled = enabledPrivate;

        console.debug(
            "Initialized cache state, with cache",
            mediaCacheEnabled,
            "and private cache",
            mediaCachePrivateEnabled
        );

        attachCacheListener();
    } catch (e) {
        console.error("Failed to read media-cache setting:", e);
        mediaCacheEnabled = false;
        mediaCachePrivateEnabled = false;
        detachCacheListener();
    }
}

// watch for runtime changes to storage and update attachment immediately
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.prototype.hasOwnProperty.call(changes, 'media-cache')) {
        const newEnabled = !!isFlagEnabled(changes['media-cache'].newValue);
        mediaCacheEnabled = newEnabled;
        console.debug("Changed media cache to", mediaCacheEnabled);
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'media-cache-private')) {
        const newEnabled = !!isFlagEnabled(changes['media-cache-private'].newValue);
        mediaCachePrivateEnabled = newEnabled;
        console.debug("Changed private media cache to", mediaCachePrivateEnabled);
    }
});

// optional: message API to force re-init from elsewhere
browser.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'initCacheListener') {
        initCacheState();
    }
});

// do initial setup
initCacheState();
