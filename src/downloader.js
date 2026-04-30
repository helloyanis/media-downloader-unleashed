/*
Copyright © 2026 🦊 helloyanis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

const ongoingDownloads = new Map(); // requestId -> {abortController, ...}

function isAbortError(error) {
  return !!(
    error && (
      error.name === 'AbortError' ||
      (typeof error.message === 'string' && /abort|cancel/i.test(error.message))
    )
  );
}

function createAbortError() {
  return new DOMException('Download cancelled by user.', 'AbortError');
}

function registerAbortController(requestId, url) {
  const existing = ongoingDownloads.get(requestId) || {};
  const abortController = new AbortController();
  ongoingDownloads.set(requestId, {
    ...existing,
    requestId,
    url,
    status: 'in-progress',
    abortController
  });
  return abortController;
}
/**
 * Tries to fetch from IndexedDB cache first.
 * If missing, falls back to network fetch.
 */
async function fetchWithCache(url, options = {}) {

  if (browser.extension.inIncognitoContext || (await browser.storage.local.get("media-cache").then((result) => result["media-cache"])) !== "1") {
    // Bypass cache in incognito/private mode or if media-cache is disabled
    console.log("⚡ Bypassing cache for:", url);
    return fetch(url, options);
  }

  try {
    const db = await openCacheDB();
    const cachedItem = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (cachedItem && cachedItem.data) {
      console.log("⚡ IndexedDB Cache hit for:", url);
      return new Response(cachedItem.data, {
        status: 200,
        statusText: "OK (Cached)",
        headers: {
          "Content-Type": cachedItem.mime || "application/octet-stream"
        }
      });
    } else {
      console.log("⚡ IndexedDB Cache miss for:", url);
    }
  } catch (e) {
    console.warn("Cache lookup failed/miss, fetching from network:", e);
  }

  // Fallback to standard network request
  return fetch(url, options);
}
// ----------------------------------------

async function downloadRawMedia(url, fileName, headers, downloadMethod, request) {
  try {
  const abortController = registerAbortController(request.requestId, url);
  const signal = abortController.signal;
      handleProgressUpdate({ action: 'updateProgress', percentage: null, requestId: request.requestId, processed: null, total: null }); // Initialize progress
      if (downloadMethod === 'browser') {
      // Use the browser.downloads API to download the file
      browser.downloads.download({
        url,
        filename: fileName,
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        method: request.method
      }).then((downloadId) => {
        console.log('Media file downloaded:', downloadId);
      }).catch((error) => {
        throw new Error('Error downloading media file with browser download method:', error);
      });

    } else {
      // Use fetch to download the file
      // Get the request headers as an object to spoof the request
      const headersObject = {};
      headers.forEach(header => {
        headersObject[header.name] = header.value;
      });

      // Send the request by fetching the URL with the appropriate method and headers (referrer can't be set in headers but can be set as a fetch option) so servers will think the request is coming from the same site
      const response = await fetchWithCache(url, {
        method: request.method,
        headers: headersObject,
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        body: request.method !== 'GET' ? request.requestBody : null,
        signal,
      });

      if (!response.ok) {
        throw new Error(`Error downloading media file with fetch: ${response.status}`);
      }

      // Get the total size from Content-Length header
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      
      // Update loading bar to show determinate progress
        if (contentLength > 0) {
          handleProgressUpdate({ action: 'updateProgress', percentage: 0, requestId: request.requestId, processed: 0, total: contentLength });
        }

      // Read the response body as a stream to track progress
      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;

      try {
        while (true) {
          if (signal.aborted) {
            throw createAbortError();
          }
          const { done, value } = await reader.read();
          
          if (done) break;
          
          chunks.push(value);
          receivedLength += value.length;
          
          // Update progress bar if we know the total size
          if (contentLength > 0) {
            const progress = receivedLength / contentLength;
            handleProgressUpdate({ action: 'updateProgress', percentage: Math.round(progress * 100), requestId: request.requestId, processed: receivedLength, total: contentLength });
          }
        }
      } catch (error) {
        reader.cancel();
        throw new Error(`Error reading response stream: ${error.message}`);
      }

      // Create a blob from the chunks and trigger a download
      const blob = new Blob(chunks);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      console.log('Media file downloaded:', blobUrl);
      URL.revokeObjectURL(blobUrl); // Clean up the blob URL
      browser.runtime.sendMessage({ action: 'downloadComplete', requestId: request.requestId });
      handleDownloadCompletion(request.requestId);
    }
  } catch (e) {
    if (isAbortError(e)) {
      browser.runtime.sendMessage({ action: 'downloadCancelled', requestId: request.requestId });
      await handleDownloadCompletion(request.requestId, false, true);
      throw new Error('DOWNLOAD_CANCELLED');
    }
    console.error("Error during raw media download:", e);
    browser.runtime.sendMessage({ action: 'downloadFailed', requestId: request.requestId, message: e.message || String(e) });
    handleDownloadCompletion(request.requestId, true);
    throw e; // Re-throw to allow popup.js to handle it as well
  }
}

/**
 * Downloads and converts an M3U8 stream to an MP4 file for offline use.
 * Uses either browser.downloads API or fetch depending on the download method.
 * Most of the code here is chatGPT so good luck finding out what it does lol (ㆆ_ㆆ)
 * @params {String} m3u8Url - The URL of the M3U8 manifest to download.
 * @params {String} fileName - The name of the file to save the downloaded content as.
 * @params {Array} headers - The headers to include in the request. The headers forbidden by fetch like Sec-* should be omitted from this array before calling this function.
 * @params {String} downloadMethod - The method to use for downloading. Either "browser" to use browser.downloads API or "fetch" to use fetch and create a blob URL.
 * @params {Object} request - The request object containing the request details.
 */
async function downloadM3U8Offline(m3u8Url, fileName, headers, downloadMethod, request) {
  try {
    const abortController = registerAbortController(request.requestId, m3u8Url);
    const signal = abortController.signal;
    // Add the current download to the ongoingDownloads map
    handleProgressUpdate({ action: 'updateProgress', percentage: null, requestId: request.requestId, processed: null, total: null }); // Initialize progress
    const getText = async (url) => {
      const res = await fetchWithCache(url, {
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        method: request.method,
        referrer:
          request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || "",
        body: request.method !== 'GET' ? request.requestBody : null,
        signal,
      });
      return res.text();
    };

    const m3u8Text = await getText(m3u8Url);
    const isMasterPlaylist = m3u8Text.includes("#EXT-X-STREAM-INF");

    let videoUrl = m3u8Url;
    let audioUrl = null;

    if (isMasterPlaylist) {
      const lines = m3u8Text.split("\n");
      const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

      let selectedVariant = await selectStreamVariant(lines, base, {
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        method: request.method
      });
      if (!selectedVariant) {
        //User canceled the variant selection, abort the download
        throw new Error("Download aborted by user during stream variant selection.");
      }
      videoUrl = selectedVariant.uri;

      const audioLine = lines.find(l => l.startsWith("#EXT-X-MEDIA:") && l.includes('TYPE=AUDIO'));
      if (audioLine) {
        const uriMatch = audioLine.match(/URI="([^"]+)"/);
        if (uriMatch) {
          const audioUri = uriMatch[1];
          audioUrl = audioUri.startsWith("http") ? audioUri : base + audioUri;
        }
      }
    }
    if (audioUrl) {
      // Display a snackbar message informing the user about the separate audio stream
      browser.runtime.sendMessage({ action: 'showAudioStreamSnackbar', requestId: request.requestId });
    }

    async function downloadSegments(playlistUrl) {
      const playlistText = await getText(playlistUrl);
      const rawLines = playlistText.split(/\r?\n/);

      // helpers for fetch options
      const fetchOpts = {
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        method: request.method,
        signal
      };

      // parse media-sequence if present
      let mediaSeq = 0;
      let hasDRM, drmAbort = false;
      for (const l of rawLines) {
        if (/^#EXT-X-KEY:/i.test(l)) {
          const method = (l.match(/METHOD=([^,]*)/) || [null, null])[1];
          if (method && method.toUpperCase().includes("SAMPLE-AES")) {
            hasDRM = true;
            break;
          }
        }
        const m = l.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
        if (m) { mediaSeq = parseInt(m[1], 10); break; }
      }

      if (hasDRM) {
        await new Promise((resolve) => {
          browser.runtime.sendMessage({ action: 'promptDRMWarning', requestId: request.requestId }, (response, error) => {
            if (response && response.continue) {
              resolve();
            } else {
              drmAbort = true;
              resolve();
            }
          });
        });
      }

      if (drmAbort) {
        throw new Error("Download aborted by user due to DRM protection.");
      }

      // Build ordered list of playlist "items" so we can process sequentially
      const items = []; // {type: 'key'|'map'|'segment', ...}
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXT-X-KEY')) {
          // capture the full line for attribute parsing later
          items.push({ type: 'key', raw: line });
        } else if (line.startsWith('#EXT-X-MAP')) {
          items.push({ type: 'map', raw: line });
        } else if (line.startsWith('#')) {
          // other tags ignored here
          continue;
        } else {
          // segment URI line
          items.push({ type: 'segment', uri: new URL(line, playlistUrl).href, rawUri: line });
        }
      }

      const segCount = items.filter(it => it.type === 'segment').length;

      const parts = [];
      let container = null; // 'fmp4' | 'ts' | 'unknown'

      // encryption state
      let currentKeyBuffer = null;   // ArrayBuffer containing 16 raw bytes
      let currentKeyUri = null;      // string
      let currentKeyIV = null;       // Uint8Array(16) or null

      // segment-based sequence for IV when not provided in EXT-X-KEY
      let processedSegmentIndex = 0; // counts only segments (for IV calc)

      // utility: build 16-byte IV where last 8 bytes are the sequence number (big-endian)
      function makeSequenceIV(seq) {
        const iv = new Uint8Array(16);
        const dv = new DataView(iv.buffer);
        // prefer setBigUint64 if available for clarity/precision
        if (typeof dv.setBigUint64 === 'function') {
          try {
            dv.setBigUint64(8, BigInt(seq), false); // big-endian, offset 8
          } catch (e) {
            // fallback below
            const high = Math.floor(seq / 0x100000000);
            const low = seq >>> 0;
            dv.setUint32(8, high, false);
            dv.setUint32(12, low, false);
          }
        } else {
          const high = Math.floor(seq / 0x100000000);
          const low = seq >>> 0;
          dv.setUint32(8, high, false);  // bytes 8..11
          dv.setUint32(12, low, false);  // bytes 12..15
        }
        return iv;
      }

      // small util: decode key response robustly (raw 16 bytes / base64 / hex)
      async function fetchAndDecodeKey(keyHref, fetchOpts) {
        const res = await fetchWithCache(keyHref, fetchOpts);
        const ab = await res.arrayBuffer();

        // 1. If it's exactly 16 bytes, it's the raw key
        if (ab.byteLength === 16) return ab;

        // 2. Otherwise, treat as text to check for Hex or Base64
        const text = new TextDecoder().decode(ab).trim().replace(/^"(.*)"$/, '$1').trim();

        // Try Hex (32 hex chars)
        if (/^[0-9a-fA-F]{32}$/.test(text)) {
          const u = new Uint8Array(16);
          for (let i = 0; i < 16; i++) u[i] = parseInt(text.substr(i * 2, 2), 16);
          return u.buffer;
        }

        // Try Base64 (A 16-byte key is 24 chars in Base64 including padding)
        if (text.length >= 22 && text.length <= 24) {
          try {
            const bin = atob(text);
            const u = Uint8Array.from(bin, c => c.charCodeAt(0));
            if (u.byteLength === 16) return u.buffer;
          } catch (e) { }
        }

        throw new Error(`Invalid key length: ${ab.byteLength} bytes. Expected 16.`);
      }

      // Decrypt helper (defensive: accept Uint8Array or ArrayBuffer)
      async function decryptSegment(encryptedBuffer, keyBuffer, iv) {
        const cryptoKey = await crypto.subtle.importKey(
          "raw",
          keyBuffer,
          { name: "AES-CBC" },
          false,
          ["decrypt"]
        );

        try {
          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv },
            cryptoKey,
            encryptedBuffer
          );
          return new Uint8Array(decrypted);
        } catch (e) {
          // If decryption fails here, the Key or IV is almost certainly wrong
          throw new Error(`WebCrypto Decrypt Failed. Check if the key/IV is correct for this segment.`);
        }
      }

      // process items sequentially
      for (let idx = 0; idx < items.length; idx++) {
        if (signal.aborted) {
          throw createAbortError();
        }
        const it = items[idx];

        if (it.type === 'key') {
          // parse attributes: METHOD=..., URI="...", IV=0x...
          const line = it.raw;
          const method = (line.match(/METHOD=([^,]*)/) || [null, null])[1];
          const uriMatch = line.match(/URI="([^"]+)"/);
          const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);

          if (!method) {
            // If method not present, treat it as NONE to be safe
            currentKeyBuffer = null;
            currentKeyUri = null;
            currentKeyIV = null;
            continue;
          }

          if (method === 'NONE') {
            currentKeyBuffer = null;
            currentKeyUri = null;
            currentKeyIV = null;
            continue;
          }

          if (method === 'AES-128') {
            if (!uriMatch) {
              throw new Error('AES-128 key line without URI');
            }
            const keyHref = new URL(uriMatch[1], playlistUrl).href;

            // parse IV if present
            if (ivMatch) {
              const ivHex = ivMatch[1];
              const ivBytes = Uint8Array.from(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
              // If shorter than 16, pad left with zeros (shouldn't normally happen)
              if (ivBytes.length < 16) {
                const padded = new Uint8Array(16);
                padded.set(ivBytes, 16 - ivBytes.length);
                currentKeyIV = padded;
              } else {
                currentKeyIV = ivBytes;
              }
            } else {
              currentKeyIV = null; // use sequence-derived IV for segments when needed
            }

            // Only fetch key if URI changed (key rotation)
            if (keyHref !== currentKeyUri) {
              currentKeyBuffer = await fetchAndDecodeKey(keyHref);
              currentKeyUri = keyHref;

              // debug
              try {
                const kb = new Uint8Array(currentKeyBuffer);
                console.debug('Fetched HLS key from', keyHref, 'len=', kb.byteLength, 'hex=', Array.from(kb).map(b => b.toString(16).padStart(2, '0')).join(''));
              } catch (e) { /* ignore */ }
            }
            continue;
          }

          // unsupported METHOD — clear key for safety
          currentKeyBuffer = null;
          currentKeyUri = null;
          currentKeyIV = null;
          continue;
        }

        if (it.type === 'map') {
          // parse URI
          const mapUriMatch = it.raw.match(/URI="([^"]+)"/);
          if (!mapUriMatch) continue;
          const mapHref = new URL(mapUriMatch[1], playlistUrl).href;

          const mapRes = await fetchWithCache(mapHref, fetchOpts);
          let mapData = new Uint8Array(await mapRes.arrayBuffer());

          // determine container from map if not set
          if (!container) {
            const ct = (mapRes.headers.get && mapRes.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('mp4') || ct.includes('iso') || ct.includes('fmp4')) container = 'fmp4';
            else {
              const hdr = String.fromCharCode(...mapData.slice(4, 8));
              if (hdr === 'ftyp' || hdr === 'styp') container = 'fmp4';
            }
          }

          // decrypt map if key active
          if (currentKeyBuffer) {
            // build IV for map: if currentKeyIV provided, use it; else IV for init per spec usually sequence "0"
            const iv = currentKeyIV
              ? currentKeyIV
              : makeSequenceIV(0); // use sequence 0 for initial map when IV not present

            mapData = await decryptSegment(mapData, currentKeyBuffer, iv);
          }

          parts.push(mapData);
          // mark container as fmp4 (init -> fmp4)
          container = container || 'fmp4';
          continue;
        }

        if (it.type === 'segment') {
          // fetch the segment
          const segUrl = it.uri;
          const res = await fetchWithCache(segUrl, fetchOpts);
          let arr = new Uint8Array(await res.arrayBuffer());

          // container detection from first segment if unknown
          if (!container && processedSegmentIndex === 0) {
            const ct = (res.headers.get && res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('mp4') || ct.includes('iso') || ct.includes('fmp4')) container = 'fmp4';
            else if (arr[0] === 0x47) container = 'ts';
            else {
              const hdr = String.fromCharCode(...arr.slice(4, 8));
              if (hdr === 'ftyp' || hdr === 'styp') container = 'fmp4';
              else container = 'unknown';
            }
          }

          // decrypt only if we currently have a key
          if (currentKeyBuffer) {
            // determine IV: currentKeyIV or sequence-based (mediaSeq + processedSegmentIndex)
            const seq = mediaSeq + processedSegmentIndex + 1;
            const iv = currentKeyIV
              ? currentKeyIV
              : makeSequenceIV(seq);

            try {
              console.debug('key hex', Array.from(new Uint8Array(currentKeyBuffer)).map(b => b.toString(16).padStart(2, '0')).join(''), 'iv hex', Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''), 'for segment seq', seq, 'url', segUrl);
              console.debug('iv used for segment:', Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''));

              arr = await decryptSegment(arr, currentKeyBuffer, iv);
            } catch (e) {
              throw new Error(`Decryption failed for segment ${segUrl}: ${e.message || e}`);
            }
          }

          parts.push(arr);
          processedSegmentIndex++;

          // update progress
          globalProcessedSegments++;
          handleProgressUpdate({ action: 'updateProgress', percentage: Math.round((globalProcessedSegments / globalTotalSegments) * 100), requestId: request.requestId, processed: globalProcessedSegments, total: globalTotalSegments });

          continue;
        }
      } // end for items

      // create final blob and extension
      if (container === 'fmp4') {
        const finalBlob = new Blob(parts, { type: "video/mp4" });
        return { blob: finalBlob, ext: '.mp4' };
      } else {
        const finalBlob = new Blob(parts, { type: "video/mp2t" });
        return { blob: finalBlob, ext: '.ts' };
      }
    }

    async function countSegments(playlistUrl) {
      const text = await getText(playlistUrl);
      return text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).length;
    }

    let globalTotalSegments = 0;
    let globalProcessedSegments = 0;


    // Count segments first
    globalTotalSegments += await countSegments(videoUrl);

    if (audioUrl) {
      globalTotalSegments += await countSegments(audioUrl);
    }

    // Then download video
    const { blob: videoBlob, ext } = await downloadSegments(videoUrl);
    const baseFileName = fileName
    const videoBlobUrl = URL.createObjectURL(videoBlob);

    if (downloadMethod === "browser") {
      await browser.downloads.download({
        url: videoBlobUrl,
        filename: audioUrl ? `${baseFileName}_video${ext}` : `${baseFileName}${ext}`
      });
    } else {
      const videoAnchor = document.createElement("a");
      videoAnchor.href = videoBlobUrl;
      videoAnchor.download = audioUrl ? `${baseFileName}_video${ext}` : `${baseFileName}${ext}`;
      document.body.appendChild(videoAnchor);
      videoAnchor.click();
      document.body.removeChild(videoAnchor);
    }

    URL.revokeObjectURL(videoBlobUrl); // Clean up the blob URL after download


    if (audioUrl) {
      const snackbar = document.createElement('mdui-snackbar');
      snackbar.setAttribute('open', true);
      snackbar.setAttribute('timeout', 10000);
      snackbar.textContent = browser.i18n.getMessage("downloadingAudioSnackbar")
      document.body.appendChild(snackbar);
      snackbar.addEventListener('close', () => {
        snackbar.remove();
      });
      const { blob: audioBlob } = await downloadSegments(audioUrl, true);

      // Save both blobs separately
      const audioBlobUrl = URL.createObjectURL(audioBlob);

      if (downloadMethod === "browser") {
        await browser.downloads.download({
          url: audioBlobUrl,
          filename: `${baseFileName}_audio.mp4`
        });
      } else {
        console.log("Triggering audio download with FETCH for", audioBlobUrl); // TODO this is debug, remove
        const audioAnchor = document.createElement("a");
        audioAnchor.href = audioBlobUrl;
        audioAnchor.download = `${baseFileName}_audio.mp4`;
        document.body.appendChild(audioAnchor);
        audioAnchor.click();
        document.body.removeChild(audioAnchor);
      }
      // TODO Handle the dialog for split downloads
      URL.revokeObjectURL(audioBlobUrl); // Clean up the blob URLs
      browser.runtime.sendMessage({ action: 'showSplitDownloadDialog', requestId: request.requestId, baseName: baseFileName, mpdUrl: m3u8Url, downloadMethod: downloadMethod });
    }
    browser.runtime.sendMessage({ action: 'downloadComplete', requestId: request.requestId });
    handleDownloadCompletion(request.requestId);
  } catch (e) {
    if (isAbortError(e)) {
      browser.runtime.sendMessage({ action: 'downloadCancelled', requestId: request.requestId });
      await handleDownloadCompletion(request.requestId, false, true);
      throw new Error('DOWNLOAD_CANCELLED');
    }
    console.error("Error during M3U8 offline download:", e);
    browser.runtime.sendMessage({ action: 'downloadFailed', requestId: request.requestId, message: e.message || String(e) });
    handleDownloadCompletion(request.requestId, true);
    throw e; // Re-throw to allow popup.js to handle it as well
  }
}


/*
  * Selects a stream variant from an m3u8 manifest.
  * If only one variant is available, it returns that variant.
  * If multiple variants are available, it prompts the user to select one based on their preference (highest, lowest, or manual selection).
  * @param {Array<String>} playlistLines - The lines of the m3u8 playlist.
  * @param {String} baseUrl - The base URL for relative URIs in the playlist.
  * @return {Promise<Object>} - A promise that resolves to the selected stream variant object containing bandwidth, resolution, and URI.
*/
async function selectStreamVariant(playlistLines, baseUrl, options = {}) {
  const variants = [];

  for (let i = 0; i < playlistLines.length; i++) {
    if (playlistLines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = playlistLines[i].match(/BANDWIDTH=(\d+)/);
      const resMatch = playlistLines[i].match(/RESOLUTION=(\d+x\d+)/);
      const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
      const resolution = resMatch ? resMatch[1] : "unknown";
      const uri = playlistLines[i + 1];
      variants.push({
        bandwidth,
        resolution,
        uri: uri.startsWith("http") ? uri : baseUrl + uri
      });
    }
  }

  // Fetch duration for each variant to estimate size
  await Promise.all(variants.map(async (variant) => {
    try {
      const res = await fetchWithCache(variant.uri, options);
      const text = await res.text();
      const duration = text.split('\n')
        .filter(line => line.startsWith("#EXTINF:"))
        .map(line => parseFloat(line.replace("#EXTINF:", "")))
        .reduce((sum, dur) => sum + dur, 0); // total seconds

      const estimatedSize = (variant.bandwidth * duration) / 8; // bytes
      variant.estimatedSize = estimatedSize;
      variant.duration = duration;
    } catch (e) {
      console.warn("Could not fetch duration for", variant.uri);
      variant.estimatedSize = null;
    }
  }));

  // If only one variant, return it
  if (variants.length === 1) return variants[0];

  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"]));
  if (preference === "highest") return variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  if (preference === "lowest") return variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));

  return new Promise((resolve) => {
    browser.runtime.sendMessage({ action: 'promptStreamVariant', variants, requestId: options.request?.requestId }, (response, error) => {
      if (response && response.selectedVariant) {
        resolve(response.selectedVariant);
      } else {
        // If user cancels, stop the download by resolving with null or throwing an error
        resolve(null);
      }
    });
  });
}


/**
 * Download a DASH (.mpd) stream offline + all segments (audio + one chosen video),
 * packaged into a ZIP so VLC can play it locally from the unzipped folder.
 *
 * Dependencies:
 *   - Client-zip (https://github.com/Touffy/client-zip) must be loaded in advance.
 *
 * @param {String} mpdUrl
 * @param {Array<{name:string,value:string}>} headers
 * @param {String} downloadMethod   – (ignored here; always uses fetch)
 * @param {Object} request          – the single request object (requests[url][selectedSizeIndex])
 */
async function downloadMPDOffline(mpdUrl, fileName, headers, downloadMethod, request) {
  try {
    const abortController = registerAbortController(request.requestId, mpdUrl);
    const signal = abortController.signal;
    // --- Helpers
    function sanitizeZipPath(originalPath) {
      if (!originalPath || typeof originalPath !== "string") return originalPath || "";
      if (/^https?:\/\//i.test(originalPath) || /^\/\//.test(originalPath)) {
        try {
          const parsed = new URL(originalPath, "http://example.invalid");
          const p = parsed.pathname.replace(/^\//, "");
          return p || parsed.hostname;
        } catch (e) {
          return originalPath.replace(/^https?:\/\//i, "").replace(/[:?#]/g, "_");
        }
      }
      const parts = originalPath.split("/");
      const out = [];
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        if (seg === "" || seg === ".") continue;
        else if (seg === "..") {
          if (out.length > 0) out.pop();
          else continue;
        } else out.push(seg);
      }
      if (out.length === 0) {
        const fallback = originalPath.split("/").filter(Boolean).slice(-1)[0] || "file";
        return fallback.replace(/[^a-zA-Z0-9._-]/g, "_");
      }
      return out.join("/");
    }

    // Fetch MPD manifest
    const resp = await fetchWithCache(mpdUrl, {
      method: request.method,
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || "",
      body: request.method !== 'GET' ? request.requestBody : null,
      signal,
    });
    if (!resp.ok) throw new Error(`Failed to fetch MPD manifest: ${resp.status}.`);
    let mpdXmlText = await resp.text();

    // Parse MPD
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(mpdXmlText, "application/xml");
    const NS = xmlDoc.documentElement.namespaceURI || "urn:mpeg:dash:schema:mpd:2011";

    const hasDRM = !!xmlDoc.getElementsByTagNameNS(NS, "ContentProtection").length;
    let drmAbort = false;
    if (hasDRM) {
      await new Promise((resolve) => {
        browser.runtime.sendMessage({ action: 'promptDRMWarning', requestId: request.requestId }, (response, error) => {
          if (response && response.continue) {
            resolve();
          } else {
            drmAbort = true;
            resolve();
          }
        });
      });
    }

    if (drmAbort) {
      throw new Error("Download aborted by user due to DRM protection.");
    }

    // Locate Period
    const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period");
    if (!periodList || periodList.length === 0) throw new Error("MPD has no Period entry.");
    const period = periodList[0];

    // Derive baseURL for ZIP entries
    let baseURLNode = period.getElementsByTagNameNS(NS, "BaseURL")[0];
    let baseURLForZip = baseURLNode ? baseURLNode.textContent.trim() : "";
    if (baseURLForZip.match(/^https?:\/\//i)) {
      try {
        const u = new URL(baseURLForZip);
        baseURLForZip = u.pathname.replace(/^\//, "");
      } catch (e) { baseURLForZip = ""; }
    }
    if (baseURLForZip && !baseURLForZip.endsWith("/")) baseURLForZip += "/";

    // Collect AdaptationSets
    const allSets = Array.from(period.getElementsByTagNameNS(NS, "AdaptationSet"));
    const adaptationSets = allSets.filter(asNode => {
      const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
      const contentType = asNode.getAttribute("contentType")?.toLowerCase() || "";
      if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return true;
      if (contentType === "audio" || contentType === "video") return true;
      const reps = asNode.getElementsByTagNameNS(NS, "Representation");
      for (let i = 0; i < reps.length; i++) {
        const rm = reps[i].getAttribute("mimeType")?.toLowerCase() || "";
        if (rm.startsWith("audio/") || rm.startsWith("video/")) return true;
      }
      return false;
    });
    if (adaptationSets.length === 0) throw new Error("MPD’s Period has no AdaptationSet for audio/video.");

    // Normalize adaptation sets
    const parsedAdaptations = adaptationSets.map(asNode => {
      const declaredType = asNode.getAttribute("contentType");
      let contentType;
      if (declaredType === "video" || declaredType === "audio") contentType = declaredType;
      else {
        const mimeType = asNode.getAttribute("mimeType")?.toLowerCase() || "";
        if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) contentType = mimeType.startsWith("video/") ? "video" : "audio";
        else {
          const reps = asNode.getElementsByTagNameNS(NS, "Representation");
          if (reps.length > 0) {
            const repMimeType = reps[0].getAttribute("mimeType")?.toLowerCase() || "";
            contentType = repMimeType.startsWith("video/") ? "video" : "audio";
          } else contentType = "video";
        }
      }

      const setSegTmplNode = asNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

      let baseSegTmpl = null;
      if (setSegTmplNode) {
        baseSegTmpl = {
          media: setSegTmplNode.getAttribute("media"),
          initialization: setSegTmplNode.getAttribute("initialization"),
          duration: parseInt(setSegTmplNode.getAttribute("duration") || "0", 10),
          timescale: parseInt(setSegTmplNode.getAttribute("timescale") || "1", 10),
          startNumber: setSegTmplNode.getAttribute("startNumber") !== null ? parseInt(setSegTmplNode.getAttribute("startNumber"), 10) : 1,
        };
      }

      const repNodes = Array.from(asNode.getElementsByTagNameNS(NS, "Representation"));
      if (repNodes.length === 0) throw new Error("AdaptationSet has no Representation elements.");

      const representations = repNodes.map(rNode => {
        const id = rNode.getAttribute("id");
        const bandwidth = parseInt(rNode.getAttribute("bandwidth") || "0", 10);
        const width = parseInt(rNode.getAttribute("width") || "0", 10);
        const height = parseInt(rNode.getAttribute("height") || "0", 10);

        const repSegTmplNode = rNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
        if (repSegTmplNode || setSegTmplNode) {
          const tmplNode = repSegTmplNode || setSegTmplNode;
          const segTmpl = {
            media: tmplNode.getAttribute("media"),
            initialization: tmplNode.getAttribute("initialization"),
            duration: parseInt(tmplNode.getAttribute("duration") || (baseSegTmpl ? baseSegTmpl.duration.toString() : "0"), 10),
            timescale: parseInt(tmplNode.getAttribute("timescale") || (baseSegTmpl ? baseSegTmpl.timescale.toString() : "1"), 10),
            startNumber: tmplNode.getAttribute("startNumber") !== null ? parseInt(tmplNode.getAttribute("startNumber"), 10) : (baseSegTmpl ? baseSegTmpl.startNumber : 1),
          };
          return { id, bandwidth, width, height, type: "segmentTemplate", segmentTemplate: segTmpl };
        }

        const repSegBaseNode = rNode.getElementsByTagNameNS(NS, "SegmentBase")[0] || asNode.getElementsByTagNameNS(NS, "SegmentBase")[0];
        if (repSegBaseNode) {
          const initNode = repSegBaseNode.getElementsByTagNameNS(NS, "Initialization")[0];
          const initRange = initNode ? initNode.getAttribute("range") : null;
          const indexRange = repSegBaseNode.getAttribute("indexRange") || null;
          const repBaseURLNode = rNode.getElementsByTagNameNS(NS, "BaseURL")[0] || asNode.getElementsByTagNameNS(NS, "BaseURL")[0];
          const baseURLText = repBaseURLNode ? repBaseURLNode.textContent.trim() : null;
          return { id, bandwidth, width, height, type: "segmentBase", baseURL: baseURLText, initRange, indexRange };
        }

        const repSegListNode = rNode.getElementsByTagNameNS(NS, "SegmentList")[0] || asNode.getElementsByTagNameNS(NS, "SegmentList")[0];
        if (repSegListNode) {
          const initNode = repSegListNode.getElementsByTagNameNS(NS, "Initialization")[0];
          const initUrl = initNode?.getAttribute("sourceURL") || initNode?.textContent?.trim() || null;

          const segNodes = Array.from(repSegListNode.getElementsByTagNameNS(NS, "SegmentURL"));
          const segmentUrls = segNodes
            .map(n => n.getAttribute("media"))
            .filter(Boolean);

          if (!initUrl) {
            throw new Error("SegmentList is missing Initialization@sourceURL.");
          }
          if (segmentUrls.length === 0) {
            throw new Error("SegmentList has no SegmentURL entries.");
          }

          return {
            id,
            bandwidth,
            width,
            height,
            type: "segmentList",
            initializationUrl: initUrl,
            segmentUrls,
          };
        }

        throw new Error("AdaptationSet missing SegmentTemplate/SegmentBase. Downloading this MPD is not supported yet.");
      });

      return { contentType, representations, node: asNode };
    });

    // find video/audio and prompt selection
    const videoAdaptation = parsedAdaptations.find(a => a.contentType === "video");
    const audioAdaptation = parsedAdaptations.find(a => a.contentType === "audio");

    if (!videoAdaptation && !audioAdaptation) {
      throw new Error("MPD has no audio or video AdaptationSet.");
    }

    const chosenVideoRep = videoAdaptation
      ? await selectMPDVideoRepresentation(videoAdaptation.representations)
      : null;

    const chosenAudioRep = audioAdaptation
      ? await selectMPDAudioRepresentation(audioAdaptation.representations)
      : null;

    const mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);
    const mpdFilename = fileName
    const baseName = mpdFilename.replace(/\.mpd$/i, "");

    const isSegmentBaseOnly =
      (!!chosenVideoRep || !!chosenAudioRep) &&
      (!chosenVideoRep || chosenVideoRep.type === "segmentBase") &&
      (!chosenAudioRep || chosenAudioRep.type === "segmentBase");

    // Unified streaming fetch with progress (single GET, no HEAD)
    // onStart(contentLength) — called once after headers are available (contentLength may be 0 if unknown)
    // onChunk(receivedBytes, contentLength) — called repeatedly while streaming
    async function fetchWithProgress(url, { onStart, onChunk } = {}) {
      const r = await fetchWithCache(url, {
        method: request.method,
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || "",
        body: request.method !== 'GET' ? request.requestBody : null,
        signal,
      });
      if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);

      const contentLength = Number(r.headers.get("Content-Length")) || 0;
      if (onStart) onStart(contentLength);

      if (!r.body) {
        if (onChunk) onChunk(0, contentLength);
        return new ArrayBuffer(0);
      }

      const reader = r.body.getReader();
      const chunks = [];
      let received = 0;
      try {
        while (true) {
          if (signal.aborted) {
            throw createAbortError();
          }
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (onChunk) onChunk(received, contentLength);
        }
      } catch (err) {
        try { reader.cancel(); } catch (e) { }
        throw new Error(`Error reading response stream: ${err?.message || err}`);
      }

      // join chunks
      const buffer = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        buffer.set(c, offset);
        offset += c.byteLength;
      }
      return buffer.buffer;
    }

    // If SegmentBase-only -> download files directly (no ZIP)
    if (isSegmentBaseOnly) {
      const snackbar = document.createElement('mdui-snackbar');
      snackbar.setAttribute('open', true);
      snackbar.setAttribute('timeout', 10000);
      snackbar.textContent = browser.i18n.getMessage("splitDownloadWarningSnackbar")
      document.body.appendChild(snackbar);
      snackbar.addEventListener('close', () => {
        snackbar.remove();
      });
      const downloads = [];
      if (chosenVideoRep) downloads.push({ rep: chosenVideoRep, label: "video" });
      if (chosenAudioRep) downloads.push({ rep: chosenAudioRep, label: "audio" });

      // Set up byte-tracking (max will grow as we discover Content-Lengths)
      handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: 0, total: 0 });
      let downloadedBytes = 0;
      let maxBytes = 0;
      let sawUnknownLength = false;

      // Helper to safely add to max
      function addToMax(n) {
        maxBytes += n;
        handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes });
      }

      for (const d of downloads) {
        const url = new URL(d.rep.baseURL, mpdBase).href;
        // Determine filename: prefer extension from baseURL, otherwise fallback
        let candidate = baseName;
        if (!candidate || candidate === "") {
          candidate = d.label === "video" ? `${baseName}_video.mp4` : `${baseName}_audio.mp4`;
        } else {
          candidate += d.label === "video" ? "_video.mp4" : "_audio.mp3";
        }
        const filename = candidate;

        console.log(`>>> Direct download ${filename} at ${d.label}:`, url);

        let lastReceivedForFile = 0;
        const buffer = await fetchWithProgress(url, {
          onStart: (contentLength) => {
            if (contentLength && contentLength > 0) {
              addToMax(contentLength);
            } else {
              // unknown content-length — show indeterminate
              sawUnknownLength = true;
              handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: null, percentage: null });
            }
          },
          onChunk: (received, contentLength) => {
            const delta = received - lastReceivedForFile;
            lastReceivedForFile = received;
            downloadedBytes += delta;
            // if we know any max, update value
            const max = contentLength && contentLength > 0 ? downloadedBytes + (contentLength - received) : maxBytes;
            if (max > 0) {
              handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: max, percentage: Math.round((downloadedBytes / max) * 100) });
            }
          }
        });

        // If we had been indeterminate and now we have bytes, clear indeterminate
        if (sawUnknownLength) {
          // If we discovered content-length for this file earlier it would have added to max.
          // We still remove indeterminate so the bar shows bytes progress accumulation.
          handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });
        }

        // Trigger download for this file
        const blob = new Blob([buffer]);
        const objectUrl = URL.createObjectURL(blob);
        if (downloadMethod === "browser") {
          await browser.downloads.download({ url: objectUrl, filename: filename });
        } else {
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        URL.revokeObjectURL(objectUrl);
      }

      // Finalize progress
      const finalMax = sawUnknownLength ? null : maxBytes;
      handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: finalMax, percentage: finalMax ? Math.round((downloadedBytes / finalMax) * 100) : null });

      console.log("✅ Direct downloads complete.");
      if(downloads.length > 1) {
        browser.runtime.sendMessage({ action: 'showSplitDownloadDialog', requestId: request.requestId, baseName: baseName, mpdUrl: mpdUrl, downloadMethod: downloadMethod });
      }
      
      browser.runtime.sendMessage({ action: 'downloadComplete', requestId: request.requestId });
      handleDownloadCompletion(request.requestId);
      return;
    }

    // --- Otherwise: existing ZIP flow (templates + bases zipped). Keep streaming progress for all resources.

    // const snackbar = document.createElement('mdui-snackbar');
    // snackbar.setAttribute('open', true);
    // snackbar.setAttribute('timeout', 10000);
    // snackbar.textContent = 'Selected media is an MPEG-DASH stream. This will download the video and audio streams separately, packaged in a ZIP file, so you can play the .mpd file in the ZIP file with VLC or any other compatible player.';
    // document.body.appendChild(snackbar);
    // snackbar.addEventListener('close', () => snackbar.remove());
    browser.runtime.sendMessage({ action: 'showMPDZipSnackbar', requestId: request.requestId });

    // Build segment template helper (substituteVars reused)
    function substituteVars(path, rep, extra = {}) {
      return path
        .replace(/\$RepresentationID\$/g, rep.id)
        .replace(/\$Bandwidth\$/g, rep.bandwidth)
        .replace(/\$Number\$/g, extra.number !== undefined ? String(extra.number) : "$Number$")
        .replace(/\$Time\$/g, extra.time !== undefined ? String(extra.time) : "$Time$");
    }

    function buildSegmentUrlsForTemplate(rep) {
      const tmpl = rep.segmentTemplate;
      const baseUrl = mpdBase;
      const initPath = substituteVars(tmpl.initialization, rep, {});
      const initUrl = new URL(initPath, baseUrl).href;
      const initZipPath = sanitizeZipPath(initPath);

      // find template node to examine SegmentTimeline if present
      let repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation")).find(r => r.getAttribute("id") === rep.id);
      let tmplNode = null;
      if (repNode) {
        tmplNode = repNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
        if (!tmplNode && repNode.parentElement) tmplNode = repNode.parentElement.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      } else tmplNode = xmlDoc.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

      let segmentStartTimes = null;
      const timelineNode = tmplNode ? tmplNode.getElementsByTagNameNS(NS, "SegmentTimeline")[0] : null;
      if (timelineNode) {
        const sElems = Array.from(timelineNode.getElementsByTagNameNS(NS, "S"));
        segmentStartTimes = [];
        let cursor = null;
        for (let i = 0; i < sElems.length; i++) {
          const s = sElems[i];
          const tAttr = s.getAttribute("t");
          const dAttr = s.getAttribute("d");
          const rAttr = s.getAttribute("r");
          if (!dAttr) throw new Error("SegmentTimeline S element missing 'd' attribute — cannot compute segments.");
          const d = parseInt(dAttr, 10);
          const r = rAttr !== null ? parseInt(rAttr, 10) : 0;
          if (tAttr !== null) cursor = parseInt(tAttr, 10);
          else if (cursor === null) cursor = 0;
          const repeatCount = r + 1;
          for (let k = 0; k < repeatCount; k++) {
            segmentStartTimes.push(cursor);
            cursor += d;
          }
        }
      }

      const usesTimeVar = tmpl.media && tmpl.media.indexOf("$Time$") !== -1;
      const mediaPaths = [];
      const mediaZipPaths = [];
      const segmentUrls = [];
      const firstIndex = tmpl.startNumber ?? 1;

      if (usesTimeVar) {
        if (!segmentStartTimes) {
          if (tmpl.duration && tmpl.duration > 0) {
            const segLen = tmpl.duration;
            const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
            const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
            const parseISODuration = d => {
              const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
              if (!m) return 0;
              const years = parseFloat(m[1] || "0");
              const months = parseFloat(m[2] || "0");
              const days = parseFloat(m[3] || "0");
              const hours = parseFloat(m[4] || "0");
              const minutes = parseFloat(m[5] || "0");
              const secs = parseFloat(m[6] || "0");
              return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
            };
            const totalSec = parseISODuration(totalDurationISO);
            const segLenSec = segLen / (tmpl.timescale || 1);
            const estimatedCount = Math.ceil(totalSec / segLenSec);
            // Build times as multiples of segLen (in timescale units)
            segmentStartTimes = [];
            for (let i = 0; i < estimatedCount; i++) segmentStartTimes.push(i * segLen);
          } else {
            throw new Error("Cannot compute $Time$ segments: SegmentTimeline missing and no fixed duration provided.");
          }
        }

        // Build media paths by replacing $Time$ with each start time
        for (let i = 0; i < segmentStartTimes.length; i++) {
          const t = segmentStartTimes[i];
          const mediaPath = substituteVars(tmpl.media, rep, { time: t, number: firstIndex + i });
          mediaPaths.push(mediaPath);
          mediaZipPaths.push(sanitizeZipPath(mediaPath));
          segmentUrls.push(new URL(mediaPath, baseUrl).href);
        }
      } else {
        // 1. Check if we parsed a SegmentTimeline earlier.
        // If the MPD has a timeline, we trust it for the segment count, 
        // even if we are using $Number$ instead of $Time$.
        if (segmentStartTimes && segmentStartTimes.length > 0) {
          for (let i = 0; i < segmentStartTimes.length; i++) {
            const number = (tmpl.startNumber ?? 1) + i;
            const mediaPath = substituteVars(tmpl.media, rep, { number });
            mediaPaths.push(mediaPath);
            mediaZipPaths.push(sanitizeZipPath(mediaPath));
            segmentUrls.push(new URL(mediaPath, baseUrl).href);
          }
        } else {
          // 2. Fallback: If no timeline, compute using fixed duration
          const mpdRoot = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
          const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
          const parseISODuration = d => {
            const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
            if (!m) return 0;
            const years = parseFloat(m[1] || "0");
            const months = parseFloat(m[2] || "0");
            const days = parseFloat(m[3] || "0");
            const hours = parseFloat(m[4] || "0");
            const minutes = parseFloat(m[5] || "0");
            const secs = parseFloat(m[6] || "0");
            return (years * 365 * 24 * 3600 + months * 30 * 24 * 3600 + days * 24 * 3600 + hours * 3600 + minutes * 60 + secs);
          };
          const totalSec = parseISODuration(totalDurationISO);

          // segLenSec: if tmpl.duration is 0/absent this will be 0 => guard
          const segLenSec = (tmpl.duration || 0) / (tmpl.timescale || 1);
          if (!segLenSec || segLenSec <= 0) throw new Error("Cannot compute number-based segments: no SegmentTimeline and duration/timescale missing or zero.");
          const segmentCount = Math.ceil(totalSec / segLenSec);
          for (let i = 0; i < segmentCount; i++) {
            const number = (tmpl.startNumber ?? 1) + i;
            const mediaPath = substituteVars(tmpl.media, rep, { number });
            mediaPaths.push(mediaPath);
            mediaZipPaths.push(sanitizeZipPath(mediaPath));
            segmentUrls.push(new URL(mediaPath, baseUrl).href);
          }
        }
      }

      return {
        initPath,
        initZipPath,
        initUrl,
        mediaPaths,
        mediaZipPaths,
        segmentUrls,
        firstIndex
      };
    }

    // Prepare zip entries and tasks
    const zipEntries = [];
    zipEntries.push({ name: mpdFilename, input: new TextEncoder().encode(mpdXmlText) });

    const tasks = [];
    function queueTemplateDownloads(repObj) {
      const info = buildSegmentUrlsForTemplate(repObj);
      tasks.push({ type: "template", rep: repObj, info });
    }
    function queueBaseDownload(repObj) {
      const baseURLText = repObj.baseURL || "";
      const resolvedUrl = new URL(baseURLText, mpdBase).href;
      let sanitized = sanitizeZipPath(baseURLText || "");
      if (!sanitized) sanitized = `${baseName}_rep${repObj.id}.mp4`;
      else if (!sanitized.match(/\.[a-zA-Z0-9]{1,6}$/)) sanitized = sanitized + `.mp4`;
      tasks.push({ type: "base", rep: repObj, url: resolvedUrl, zipName: sanitized, baseURLText });
    }
    function queueListDownload(repObj) {
      const initUrl = new URL(repObj.initializationUrl, mpdBase).href;
      const initZipPath = sanitizeZipPath(repObj.initializationUrl);

      const segmentUrls = repObj.segmentUrls.map(u => new URL(u, mpdBase).href);
      const segmentZipPaths = repObj.segmentUrls.map(u => sanitizeZipPath(u));

      tasks.push({
        type: "list",
        rep: repObj,
        info: {
          initUrl,
          initZipPath,
          segmentUrls,
          segmentZipPaths,
        }
      });
    }

    // Queue chosen reps
    if (chosenVideoRep) {
      if (chosenVideoRep.type === "segmentTemplate") queueTemplateDownloads(chosenVideoRep);
      else if (chosenVideoRep.type === "segmentBase") queueBaseDownload(chosenVideoRep);
      else if (chosenVideoRep.type === "segmentList") queueListDownload(chosenVideoRep);
      else throw new Error("Unsupported video representation type");
    }

    if (chosenAudioRep) {
      if (chosenAudioRep.type === "segmentTemplate") queueTemplateDownloads(chosenAudioRep);
      else if (chosenAudioRep.type === "segmentBase") queueBaseDownload(chosenAudioRep);
      else if (chosenAudioRep.type === "segmentList") queueListDownload(chosenAudioRep);
      else throw new Error("Unsupported audio representation type");
    }

    // Setup dynamic byte-tracking progress for ZIP flow
    handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: 0, total: tasks.length, percentage: 0 });
    let downloadedBytes = 0;
    let maxBytes = 0;

    function addToMax(n) {
      maxBytes += n;
      handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });
    }

    const mpdFixEnabled = (await browser.storage.local.get("mpd-fix").then((result) => result["mpd-fix"])) === "1";
    const repIdToLocalName = {};

    // Process tasks sequentially (streaming)
    for (const t of tasks) {
      if (signal.aborted) {
        throw createAbortError();
      }
      if (t.type === "template") {
        // init
        console.log(">>> Fetching template init:", t.info.initUrl);
        // Use a simple count-based progress for template flows (init + N segments)
        maxBytes = t.info.segmentUrls.length + 1;
        handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });

        const initBuf = await fetchWithProgress(t.info.initUrl, {
          onStart: (contentLength) => {
            // If content-length known, account for it in maxBytes as bytes.
            // We keep the count-based max for template flows for simplicity.
          },
          onChunk: (received, contentLength) => {
            // We don't use per-byte accounting here; progress is tracked per-file.
          }
        });
        zipEntries.push({ name: prefixedName(t.info.initZipPath), input: initBuf });
        // mark init file as processed
        downloadedBytes += 1;
        handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });

        // segments
        for (let i = 0; i < t.info.segmentUrls.length; i++) {
          const segUrl = t.info.segmentUrls[i];
          const segZipPath = t.info.mediaZipPaths[i];
          console.log(`>>> Fetching template segment #${i + 1}:`, segUrl);
          let lastReceived = 0;
          const buf = await fetchWithProgress(segUrl, {
            onStart: (contentLength) => {
              // per-segment start
            },
            onChunk: (received, contentLength) => {
              // not using byte-level accounting here; finalization increments per-file counter
            }
          });
          zipEntries.push({ name: prefixedName(segZipPath), input: buf });
          downloadedBytes += 1;
          handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });
        }

      } else if (t.type === "base") {
        console.log(">>> Fetching SegmentBase file (single-file MP4):", t.url);
        let lastReceivedForFile = 0;
        const arrayBuffer = await fetchWithProgress(t.url, {
          onStart: (contentLength) => {
            if (contentLength && contentLength > 0) addToMax(contentLength);
            else handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: null, percentage: null });
          },
          onChunk: (received) => {
            const delta = received - lastReceivedForFile;
            lastReceivedForFile = received;
            downloadedBytes += delta;
            const max = maxBytes || 0
            if (max > 0) handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: max, percentage: Math.round(((downloadedBytes) / max) * 100) });
          }
        });

        const finalZipName = prefixedName(t.zipName);
        zipEntries.push({ name: finalZipName, input: arrayBuffer });

        if (mpdFixEnabled) repIdToLocalName[t.rep.id] = t.zipName;
      } else if (t.type === "list") {
        console.log(">>> Fetching SegmentList init:", t.info.initUrl);
        let lastReceivedForFile = 0;
        const initBuf = await fetchWithProgress(t.info.initUrl, {
          onStart: (contentLength) => {
            if (contentLength && contentLength > 0) addToMax(contentLength);
            else handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: null, percentage: null });
          },
          onChunk: (received) => {
            const delta = received - lastReceivedForFile;
            lastReceivedForFile = received;
            downloadedBytes += delta;
            const max = maxBytes || 0;
            if (max > 0) handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: max, percentage: Math.round(((downloadedBytes) / max) * 100) });
          }
        });

        zipEntries.push({ name: prefixedName(t.info.initZipPath), input: initBuf });
        maxBytes = t.info.segmentUrls.length;
        handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });
        for (let i = 0; i < t.info.segmentUrls.length; i++) {
          const segUrl = t.info.segmentUrls[i];
          const segZipPath = t.info.segmentZipPaths[i];

          console.log(`>>> Fetching SegmentList segment #${i + 1}:`, segUrl);
          let lastReceived = 0;
          const buf = await fetchWithProgress(segUrl, {
            onStart: (contentLength) => {
            },
            onChunk: (received) => {
            }
          });
          zipEntries.push({ name: prefixedName(segZipPath), input: buf });
          // count-based progress increment for each segment fetched
          downloadedBytes += 1;
          handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: Math.round((downloadedBytes / maxBytes) * 100) });
        }
        if (mpdFixEnabled) repIdToLocalName[t.rep.id] = { type: "list", init: t.info.initZipPath, segments: t.info.segmentZipPaths };
      }
    }

    // mpd-fix rewrite if needed
    function pruneToSelectedRepresentations(xmlDoc, NS, selectedRepIds) {
      const adaptationSets = Array.from(xmlDoc.getElementsByTagNameNS(NS, "AdaptationSet"));

      for (const asNode of adaptationSets) {
        const reps = Array.from(asNode.getElementsByTagNameNS(NS, "Representation"));

        for (const rep of reps) {
          const repId = rep.getAttribute("id");
          if (!selectedRepIds.has(repId)) {
            rep.parentElement?.removeChild(rep);
          }
        }

        // Remove empty AdaptationSets
        if (!asNode.getElementsByTagNameNS(NS, "Representation").length) {
          asNode.parentElement?.removeChild(asNode);
        }
      }
    }
    if (mpdFixEnabled) {
      // Build selected representations set
      const selectedRepIds = new Set();
      if (chosenVideoRep) selectedRepIds.add(chosenVideoRep.id);
      if (chosenAudioRep) selectedRepIds.add(chosenAudioRep.id);

      // Remove unused representations
      pruneToSelectedRepresentations(xmlDoc, NS, selectedRepIds);
      for (const repId in repIdToLocalName) {
        const repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation"))
          .find(r => r.getAttribute("id") === repId);
        if (!repNode) continue;

        const meta = repIdToLocalName[repId];

        if (typeof meta === "string") {
          // existing SegmentBase logic
          const segBases = Array.from(repNode.getElementsByTagNameNS(NS, "SegmentBase"));
          segBases.forEach(n => n.parentElement && n.parentElement.removeChild(n));
          let baseNode = repNode.getElementsByTagNameNS(NS, "BaseURL")[0];
          if (!baseNode) {
            baseNode = xmlDoc.createElementNS(NS, "BaseURL");
            if (repNode.firstChild) repNode.insertBefore(baseNode, repNode.firstChild);
            else repNode.appendChild(baseNode);
          }
          baseNode.textContent = meta;
        } else if (meta?.type === "list") {
          const initNode = repNode.getElementsByTagNameNS(NS, "Initialization")[0];
          if (initNode) {
            initNode.setAttribute("sourceURL", meta.init);
          }

          const segNodes = Array.from(repNode.getElementsByTagNameNS(NS, "SegmentURL"));
          segNodes.forEach((node, idx) => {
            if (meta.segments[idx]) {
              node.setAttribute("media", meta.segments[idx]);
            }
          });
        }
      }

      const serializer = new XMLSerializer();
      mpdXmlText = serializer.serializeToString(xmlDoc);
      zipEntries[0] = { name: mpdFilename, input: new TextEncoder().encode(mpdXmlText) };
    }

    // finalize progress
    handleProgressUpdate({ action: 'updateProgress', requestId: request.requestId, processed: downloadedBytes, total: maxBytes, percentage: maxBytes ? Math.round((downloadedBytes / maxBytes) * 100) : null });

    // Generate ZIP and trigger download
    console.log("▶️ All segments fetched; generating ZIP…");
    const zipBlob = await downloadZip(zipEntries).blob();
    const zipName = `${baseName}.zip`;

    if (downloadMethod === "browser") {
      await browser.downloads.download({ url: URL.createObjectURL(zipBlob), filename: zipName });
    } else {
      // Use a temporary <a> element to trigger download
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    }


    browser.runtime.sendMessage({ action: 'showMPDDownloadCompleteDialog', requestId: request.requestId, baseName: baseName, mpdUrl: mpdUrl, downloadMethod: downloadMethod, zipUrl: URL.createObjectURL(zipBlob) });
    browser.runtime.sendMessage({ action: 'downloadComplete', requestId: request.requestId });
    handleDownloadCompletion(request.requestId);

    // Helper: prefix zip path
    function prefixedName(path) {
      if (!baseURLForZip) return path;
      if (path.startsWith(baseURLForZip)) return path;
      return baseURLForZip + path;
    }
  } catch (err) {
    if (isAbortError(err)) {
      browser.runtime.sendMessage({ action: 'downloadCancelled', requestId: request.requestId });
      await handleDownloadCompletion(request.requestId, false, true);
      throw new Error('DOWNLOAD_CANCELLED');
    }
    console.error("Error during MPD download process:", err);
    // showDialog(browser.i18n.getMessage("mpdDownloadErrorMessage", [err.message]), browser.i18n.getMessage("mpdDownloadErrorTitle"), { error: err.message, url: mpdUrl, request, downloadMethod }); TODO move this
    browser.runtime.sendMessage({ action: 'downloadFailed', requestId: request.requestId, error: err.message });
    handleDownloadCompletion(request.requestId, true);
  }
}

/**
 * Helper: prompt the user to select one video Representation from an MPD’s AdaptationSet.
 * Very similar to selectStreamVariant(...) for m3u8, but adapted to DASH.
 *
 * @param {Array<{ id: string, bandwidth: number, width: number, height: number }>} reps
 *        Array of all <Representation> objects (with at least id, bandwidth, width, height).
 * @returns {Promise<{ id: string, bandwidth: number, width: number, height: number }>}
 *          Resolves to the chosen representation object.
 */
async function selectMPDVideoRepresentation(reps) {
  // If there's only one rep, no need to ask.
  if (reps.length === 1) {
    return reps[0];
  }

  // Check saved preference
  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"])); // "highest" | "lowest" or "ask"

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  return new Promise((resolve) => {
    browser.runtime.sendMessage({ action: 'promptMPDVideoRepresentation', reps }, (response, error) => {
      if (error) {
        console.error("Error prompting for video representation:", error);
        throw new Error("Failed to prompt for video representation");
      }
      resolve(response.selectedRep);
    });
  });
}

/**
 * Helper: prompt the user to select one audio Representation from an MPD’s AdaptationSet.
 * Very similar to selectStreamVariant(...) for m3u8, but adapted to DASH.
 * @param {Array<{ id: string, bandwidth: number }>} reps
 *       Array of all <Representation> objects (with at least id, bandwidth).
 * @returns {Promise<{ id: string, bandwidth: number }>}
 *          Resolves to the chosen representation object.
 */
async function selectMPDAudioRepresentation(reps, requestId) {
  // If there's only one rep, no need to ask.
  if (reps.length === 1) {
    return reps[0];
  }

  // Check saved preference
  const preference = (await browser.storage.local.get("stream-quality").then((result) => result["stream-quality"])); // "highest" | "lowest" or "ask"

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  return new Promise((resolve) => {
    browser.runtime.sendMessage({ action: 'promptMPDAudioRepresentation', reps, requestId }, (response, error) => {
      if (error) {
        console.error("Error prompting for audio representation:", error);
        throw new Error("Failed to prompt for audio representation");
      }
      resolve(response.selectedRep);
    });
  });
}

function handleProgressUpdate(message) {
  browser.runtime.sendMessage(message); // Forward to front-end to update the loading bar there as well
  const id = message.requestId;
  const { percentage, processed, total } = message;
  if (!id) return;

  const existing = ongoingDownloads.get(id);
  const nextEntry = {
    requestId: id,
    url: message.url ?? existing?.url,
    status: 'in-progress',
    progress: { percentage, processed, total }
  };

  ongoingDownloads.set(id, existing ? { ...existing, ...nextEntry } : nextEntry);

  // Update the extension badge with global progress percentage from all ongoing downloads
  const downloads = Array.from(ongoingDownloads.values());
  const totalPercentage = downloads.length
    ? Math.round(downloads.reduce((acc, d) => acc + (d.progress?.percentage || 0), 0) / downloads.length)
    : 0;
  browser.action.setBadgeText({ text: totalPercentage > 0 ? `${totalPercentage}%` : '' });
}

async function handleDownloadCompletion(id, failed = false, cancelled = false) {

  const existing = ongoingDownloads.get(id);
  if (existing) {
    // Remove from ongoing downloads
    ongoingDownloads.delete(id);
  }

  // Clear badge if no more in-progress downloads
  if (ongoingDownloads.size === 0) {
    browser.action.setBadgeText({ text: '' });
  }

  // Add request ID to session storage completed/failed lists.
  // Storage values may be missing, wrapped in an object, or legacy JSON strings.
  const toArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  };

  const completedRaw = await browser.storage.session.get('completedDownloads');
  const failedRaw = await browser.storage.session.get('failedDownloads');
  const completedDownloads = toArray(completedRaw?.completedDownloads);
  const failedDownloads = toArray(failedRaw?.failedDownloads);

  // Replace existing entries instead of duplicating when a retry flips status.
  const existingCompletedIndex = completedDownloads.indexOf(id);
  if (existingCompletedIndex !== -1) completedDownloads.splice(existingCompletedIndex, 1);
  const existingFailedIndex = failedDownloads.indexOf(id);
  if (existingFailedIndex !== -1) failedDownloads.splice(existingFailedIndex, 1);

  if (!cancelled) {
    if (!failed) {
      completedDownloads.push(id);
    } else {
      failedDownloads.push(id);
    }
  }

  await browser.storage.session.set({ completedDownloads, failedDownloads });
}

browser.runtime.onMessage.addListener((message) => {
  console.log("Received message in content script:", message);
  switch (message.action) {
    case 'downloadRawMedia':
      return downloadRawMedia(message.url, message.fileName, message.headers, message.downloadMethod, message.request).then(() => ({ success: true }))
      break;
    case 'downloadM3U8Offline':
      return downloadM3U8Offline(message.url, message.fileName, message.headers, message.downloadMethod, message.request).then(() => ({ success: true }))
      break;
    case 'downloadMPDOffline':
      return downloadMPDOffline(message.url, message.fileName, message.headers, message.downloadMethod, message.request).then(() => ({ success: true }))
      break;
    case 'getOngoingDownloads':
      return Promise.resolve(Array.from(ongoingDownloads.values()).map(d => ({ requestId: d.requestId, url: d.url, status: d.status, progress: d.progress })));
      break;
    case 'cancelDownload': {
      const entry = ongoingDownloads.get(message.requestId);
      if (!entry) {
        return Promise.resolve({ cancelled: false });
      }

      if (entry.abortController && !entry.abortController.signal.aborted) {
        entry.abortController.abort();
      }

      return Promise.resolve({ cancelled: true });
    }
  }
});