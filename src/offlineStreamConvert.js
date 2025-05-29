/**
 * Downloads and converts an M3U8 stream to an MP4 file for offline use.
 * Uses either browser.downloads API or fetch depending on the download method.
 * Most of the code here is chatGPT so good luck finding out what it does lol (ㆆ_ㆆ)
 */
async function downloadM3U8Offline(m3u8Url, headers, downloadMethod, loadingBar, request) {
    const getText = async (url) => {
        const res = await fetch(url, {
            headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
            referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
            method: request.method
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

        const selectedVariant = await selectStreamVariant(lines, base);
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
        const snackbar = document.createElement('mdui-snackbar');
        snackbar.setAttribute('open', true);
        snackbar.setAttribute('timeout', 10000);
        snackbar.textContent = 'Separate audio stream detected. Downloading video and audio separately (There will be 2 downloads).'
        document.body.appendChild(snackbar);
        snackbar.addEventListener('close', () => {
            snackbar.remove();
        });
    }

    async function downloadSegments(playlistUrl, isAudio = false) {
        let totalSegments = 0;
        let downloadedSegments = 0;
        const playlistText = await getText(playlistUrl);
        const base = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);

        const lines = playlistText.split("\n");

        let keyUri = null;
        let ivHex = null;
        let keyBuffer = null;

        // Find key line
        for (const line of lines) {
            if (line.startsWith("#EXT-X-KEY")) {
                const uriMatch = line.match(/URI="([^"]+)"/);
                const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);
                if (uriMatch) keyUri = uriMatch[1];
                if (ivMatch) ivHex = ivMatch[1];
                break;
            }
        }

        // Fetch key if present
        if (keyUri) {
            const fullKeyUri = new URL(keyUri, playlistUrl).href;
            const keyRes = await fetch(fullKeyUri, {
                headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
                referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
                method: request.method
            });
            keyBuffer = await keyRes.arrayBuffer();
        }

        const tsUrls = lines
            .filter(line => line && !line.startsWith("#"))
            .map(line => new URL(line, playlistUrl).href);

        totalSegments += tsUrls.length;

        const segmentBuffers = [];

        for (let i = 0; i < tsUrls.length; i++) {
            const res = await fetch(tsUrls[i], {
                headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
                referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
                method: request.method
            });

            let data = new Uint8Array(await res.arrayBuffer());

            if (keyBuffer) {
                const iv = ivHex
                    ? Uint8Array.from(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
                    : (() => {
                        const iv = new Uint8Array(16);
                        const view = new DataView(iv.buffer);
                        view.setUint32(12, i); // segment index as IV
                        return iv;
                    })();

                data = await decryptSegment(data, keyBuffer, iv);
            }

            segmentBuffers.push(data);

            downloadedSegments++;
            loadingBar.removeAttribute('indeterminate');
            loadingBar.setAttribute("value", downloadedSegments / totalSegments);
        }

        const finalTsBlob = new Blob(segmentBuffers, { type: "video/MP2T" });
        return finalTsBlob;
    }
    async function decryptSegment(encryptedBuffer, keyBuffer, iv) {
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyBuffer,
            { name: "AES-CBC" },
            false,
            ["decrypt"]
        );

        const decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: "AES-CBC",
                iv
            },
            cryptoKey,
            encryptedBuffer
        );

        return new Uint8Array(decryptedBuffer);
    }

    const videoBlob = await downloadSegments(videoUrl, false);

    const baseFileName = getFileName(m3u8Url);
    if (audioUrl) {
        loadingBar.setAttribute('aria-label', 'Downloading audio stream...');
        const snackbar = document.createElement('mdui-snackbar');
        snackbar.setAttribute('open', true);
        snackbar.setAttribute('timeout', 10000);
        snackbar.textContent = 'Downloading audio stream...'
        document.body.appendChild(snackbar);
        snackbar.addEventListener('close', () => {
            snackbar.remove();
        });
        const audioBlob = await downloadSegments(audioUrl, true);

        // Save both blobs separately
        const videoBlobUrl = URL.createObjectURL(videoBlob);
        const audioBlobUrl = URL.createObjectURL(audioBlob);

        if (downloadMethod === "browser") {
            await browser.downloads.download({
                url: videoBlobUrl,
                filename: `${baseFileName}_video.ts`
            });
            await browser.downloads.download({
                url: audioBlobUrl,
                filename: `${baseFileName}_audio.ts`
            });
        } else {
            const videoAnchor = document.createElement("a");
            videoAnchor.href = videoBlobUrl;
            videoAnchor.download = `${baseFileName}_video.ts`;
            document.body.appendChild(videoAnchor);
            videoAnchor.click();
            document.body.removeChild(videoAnchor);

            const audioAnchor = document.createElement("a");
            audioAnchor.href = audioBlobUrl;
            audioAnchor.download = `${baseFileName}_audio.ts`;
            document.body.appendChild(audioAnchor);
            audioAnchor.click();
            document.body.removeChild(audioAnchor);
        }
        showDialog(`Both video and audio streams have been downloaded. You can merge them both with <a href='https://ffmpeg.org/'>ffmpeg</a> using the following command :<br/><code>ffmpeg -i ${baseFileName}_video.ts -i ${baseFileName}_audio.ts -c copy final_video.mp4`,"Downloaded separated audio and video streams");
        URL.revokeObjectURL(videoBlobUrl);
        URL.revokeObjectURL(audioBlobUrl); // Clean up the blob URLs
        return;
    } else {
        const videoBlobUrl = URL.createObjectURL(videoBlob);

        if (downloadMethod === "browser") {
            await browser.downloads.download({
                url: videoBlobUrl,
                filename: `${baseFileName}.ts`
            });
        } else {
            const videoAnchor = document.createElement("a");
            videoAnchor.href = videoBlobUrl;
            videoAnchor.download = `${baseFileName}.ts`;
            document.body.appendChild(videoAnchor);
            videoAnchor.click();
            document.body.removeChild(videoAnchor);
        }
    }
}


/**
 * Download a DASH (.mpd) stream offline + all segments (audio + one chosen video),
 * packaged into a ZIP so VLC can play it locally from the unzipped folder.
 *
 * Dependencies:
 *   - JSZip (https://stuk.github.io/jszip/) must be loaded in advance.
 *
 * @param {String} mpdUrl
 * @param {Array<{name:string,value:string}>} headers
 * @param {String} downloadMethod   – (ignored here; always uses fetch)
 * @param {HTMLElement} loadingBar  – the <mdui-linear-progress> element
 * @param {Object} request          – the single request object (requests[url][selectedSizeIndex])
 */
async function downloadMPDOffline(mpdUrl, headers, downloadMethod, loadingBar, request) {
  // 1) Fetch the MPD manifest text
  const resp = await fetch(mpdUrl, {
    method: request.method,
    headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
    referrer:
      request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || ""
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch MPD manifest: ${resp.status}. Server might be throttling you or the download system is broken for this URL.`);
  }
  let mpdXmlText = await resp.text();

  // 2) Parse with DOMParser (namespace-aware)
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(mpdXmlText, "application/xml");
  const NS = "urn:mpeg:dash:schema:mpd:2011";

  const hasDRM = !!xmlDoc.getElementsByTagNameNS(NS, "ContentProtection").length;
  if (hasDRM) {
    throw new Error("This MPD uses DRM (ContentProtection). Cannot download encrypted streams. Maybe you can get around this by setting your browser to deny DRM content (e.g. in Firefox: about:preferences#general → Digital Rights Management Content). But on most sites they won't deliver the MPD at all if DRM is disabled, so this has a low chance to work. Sorry! 😢");
  }


  // 3) Find the first <Period>
  const periodList = xmlDoc.getElementsByTagNameNS(NS, "Period");
  if (!periodList || periodList.length === 0) {
    throw new Error("MPD has no Period entry. This might mean it’s not a valid MPD (or gets detected as an MPD but isn't).");
  }
  const period = periodList[0];

  // 4) Collect all <AdaptationSet> inside that <Period>
  const allSets = Array.from(
    period.getElementsByTagNameNS(NS, "AdaptationSet")
  );

  // Filter to only audio/mp4 or video/mp4 AdaptationSets
  const adaptationSets = allSets.filter(asNode => {
    const mimeType = asNode.getAttribute("mimeType") || "";
    return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
  });
  if (adaptationSets.length === 0) {
    throw new Error("MPD’s Period has no AdaptationSet for audio/video. This might mean it’s not a valid MPD (or gets detected as an MPD but isn't).");
  }

  // 5) Build a simpler structure: { contentType, segmentTemplate, representations[] }
  const parsedAdaptations = adaptationSets.map((asNode) => {
    // Determine contentType (video or audio)
    const declaredType = asNode.getAttribute("contentType");
    let contentType;
    if (declaredType === "video" || declaredType === "audio") {
      contentType = declaredType;
    } else {
      const mimeType = asNode.getAttribute("mimeType") || "";
      contentType = mimeType.startsWith("video/") ? "video" : "audio";
    }

    // Exactly one <SegmentTemplate> per AdaptationSet (else error)
    const stList = asNode.getElementsByTagNameNS(NS, "SegmentTemplate");
    if (!stList || stList.length === 0) {
      throw new Error("AdaptationSet missing SegmentTemplate. This might mean it’s not a valid MPD (or gets detected as an MPD but isn't).");
    }
    const st = stList[0];

    // Grab attributes from SegmentTemplate
    const mediaTmpl      = st.getAttribute("media");            // e.g. "video/250kbit/segment_$Number$.m4s"
    const initTmpl       = st.getAttribute("initialization");   // e.g. "video/250kbit/init.mp4"
    const duration       = parseInt(st.getAttribute("duration") || "0", 10);
    const timescale      = parseInt(st.getAttribute("timescale") || "1", 10);
    const startNumberRaw = st.getAttribute("startNumber");
    const startNumber    = startNumberRaw !== null ? parseInt(startNumberRaw, 10) : 1;

    const segmentTemplate = {
      media:          mediaTmpl,
      initialization: initTmpl,
      duration,
      timescale,
      startNumber,
      segmentTimeline: null // (we assume no inline <SegmentTimeline>)
    };

    // Gather all <Representation> children
    const repNodes = Array.from(
      asNode.getElementsByTagNameNS(NS, "Representation")
    );
    if (repNodes.length === 0) {
      throw new Error("AdaptationSet has no Representation children. This might mean it’s not a valid MPD (or gets detected as an MPD but isn't).");
    }
    const representations = repNodes.map((rNode) => ({
      id:        rNode.getAttribute("id"),
      bandwidth: parseInt(rNode.getAttribute("bandwidth") || "0", 10),
      width:     parseInt(rNode.getAttribute("width")     || "0", 10),
      height:    parseInt(rNode.getAttribute("height")    || "0", 10),
      // codecs, frameRate, etc. are also available if needed
    }));

    return {
      contentType,
      segmentTemplate,
      representations
    };
  });

  // 6) Separate “video” vs. “audio”
  const videoAdaptation = parsedAdaptations.find(a => a.contentType === "video");
  const audioAdaptation = parsedAdaptations.find(a => a.contentType === "audio");
  if (!videoAdaptation) {
    throw new Error("No video AdaptationSet found in MPD.");
  }

  // 7) Ask the user to pick one video Representation (unless they forced highest/lowest)
  const chosenVideoRep = await selectMPDVideoRepresentation(videoAdaptation.representations);

  // 8) For audio, just pick the highest‐bandwidth (if present)
  let chosenAudioRep = await selectMPDAudioRepresentation(audioAdaptation ? audioAdaptation.representations : []);

  console.log("Chosen video Representation:", chosenVideoRep);
  console.log("Chosen audio Representation:", chosenAudioRep);

  // 9) Build “initialization” URL + array of “media segment” URLs for the chosen rep
  function buildSegmentUrls(rep, adaptationInfo) {
    const tmpl    = adaptationInfo.segmentTemplate;
    const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);

    // 9a) initialization URL & relative path
    const initPath = tmpl.initialization
      .replace(/\$RepresentationID\$/g, rep.id)
      .replace(/\$Bandwidth\$/g,       rep.bandwidth);
    const initUrl  = new URL(initPath, baseUrl).href;

    // 9b) compute how many segments (no <SegmentTimeline> present)
    const mpdRoot          = xmlDoc.getElementsByTagNameNS(NS, "MPD")[0];
    const totalDurationISO = mpdRoot.getAttribute("mediaPresentationDuration");
    const parseISODuration = d => {
      // Supports “P…T…H…M…S” (e.g. “P0Y0M0DT0H3M30.000S”)
      const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d);
      if (!m) return 0;
      const years   = parseFloat(m[1]||"0");
      const months  = parseFloat(m[2]||"0");
      const days    = parseFloat(m[3]||"0");
      const hours   = parseFloat(m[4]||"0");
      const minutes = parseFloat(m[5]||"0");
      const secs    = parseFloat(m[6]||"0");
      return (
        years * 365 * 24 * 3600 +
        months * 30 * 24 * 3600 +
        days * 24 * 3600 +
        hours * 3600 +
        minutes * 60 +
        secs
      );
    };
    const totalSec   = parseISODuration(totalDurationISO);
    const segLenSec  = tmpl.duration / tmpl.timescale; // e.g. 2000 / 1000 = 2 sec/segment
    const segmentCount = Math.ceil(totalSec / segLenSec);

    // 9c) build each media segment URL & relative path
    const segmentUrls  = [];
    const mediaPaths   = [];
    const firstIndex   = tmpl.startNumber;
    for (let n = firstIndex; n < firstIndex + segmentCount; n++) {
      const mediaPath = tmpl.media
        .replace(/\$RepresentationID\$/g, rep.id)
        .replace(/\$Bandwidth\$/g,       rep.bandwidth)
        .replace(/\$Number\$/g,          n);
      mediaPaths.push(mediaPath);
      segmentUrls.push(new URL(mediaPath, baseUrl).href);
    }

    return {
      initPath,       // e.g. "video/6000kbit/init.mp4"
      initUrl,        // full URL
      mediaPaths,     // e.g. ["video/6000kbit/segment_1.m4s", ...]
      segmentUrls,    // full URLs array
      firstIndex
    };
  }

  // 10) Build URLs (and relative paths) for the chosen vídeo & audio
  const videoInfo = buildSegmentUrls(chosenVideoRep, videoAdaptation);
  let audioInfo   = null;
  if (chosenAudioRep) {
    audioInfo = buildSegmentUrls(chosenAudioRep, audioAdaptation);
  }

  // 10.5) If mpd fix mode is on, strip unused <Representation> entries
if (localStorage.getItem("mpd-fix") === "1") {
  console.log("✂️ Stripping unused representations for 'mpd fix' mode...");

  // Helper to remove unselected representations
  const keepOnlyRepresentation = (adaptationNode, chosenRepId) => {
    const reps = adaptationNode.getElementsByTagNameNS(NS, "Representation");
    for (let i = reps.length - 1; i >= 0; i--) {
      const rep = reps[i];
      if (rep.getAttribute("id") !== chosenRepId) {
        adaptationNode.removeChild(rep);
      }
    }
  };

  // Strip unused video representations
  const videoSet = allSets.find(asNode => {
    const mimeType = asNode.getAttribute("mimeType") || "";
    return mimeType.startsWith("video/");
  });
  if (videoSet) {
    keepOnlyRepresentation(videoSet, chosenVideoRep.id);
  }

  // Strip unused audio representations
  const audioSet = allSets.find(asNode => {
    const mimeType = asNode.getAttribute("mimeType") || "";
    return mimeType.startsWith("audio/");
  });
  if (audioSet && chosenAudioRep) {
    keepOnlyRepresentation(audioSet, chosenAudioRep.id);
  }

  // Update the XML string to only include the kept elements
  const serializer = new XMLSerializer();
  const strippedMPD = serializer.serializeToString(xmlDoc);
  mpdXmlText = strippedMPD;  // override the variable used when adding to ZIP
}


  // 11) Create a new JSZip instance
  const zip = new JSZip();

  // 12) Add the original MPD text as “<whatever>.mpd”
  const mpdFilename = mpdUrl.substring(mpdUrl.lastIndexOf("/") + 1); // e.g. "sintel.mpd"
  zip.file(mpdFilename, mpdXmlText);

  // 13) Prepare to fetch + add every init + media segment to the ZIP.
  //     Count how many files total so we can show progress in `loadingBar`.
  const videoCount = 1 + videoInfo.segmentUrls.length; // 1 init + N media
  const audioCount = audioInfo ? (1 + audioInfo.segmentUrls.length) : 0;
  const totalFiles = videoCount + audioCount;

  loadingBar.removeAttribute("indeterminate");
  loadingBar.setAttribute("max", totalFiles);
  loadingBar.setAttribute("value", 0);

  let downloadedCount = 0;

  // Helper to fetch a URL → ArrayBuffer
  async function fetchArrayBuffer(url) {
    const r = await fetch(url, {
      method:  request.method,
      headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
      referrer:
        request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || ""
    });
    if (!r.ok) {
      throw new Error(`Segment fetch failed: ${url} (status ${r.status})`);
    }
    return await r.arrayBuffer();
  }

  // 14) Download Video Init + add to ZIP under its relative path
  console.log(">>> Fetching video init:", videoInfo.initUrl);
  const vInitBuf = await fetchArrayBuffer(videoInfo.initUrl);
  zip.file(videoInfo.initPath, vInitBuf);
  downloadedCount++;
  loadingBar.setAttribute("value", downloadedCount);

  // 15) Download Audio Init (if any) + add to ZIP
  let aInitBuf = null;
  if (audioInfo) {
    console.log(">>> Fetching audio init:", audioInfo.initUrl);
    aInitBuf = await fetchArrayBuffer(audioInfo.initUrl);
    zip.file(audioInfo.initPath, aInitBuf);
    downloadedCount++;
    loadingBar.setAttribute("value", downloadedCount);
  }

  // 16) Download all video media segments
  for (let i = 0; i < videoInfo.segmentUrls.length; i++) {
    const segUrl  = videoInfo.segmentUrls[i];
    const segPath = videoInfo.mediaPaths[i];
    console.log(`>>> Fetching video segment #${i + 1}:`, segUrl);
    const buf = await fetchArrayBuffer(segUrl);
    zip.file(segPath, buf);
    downloadedCount++;
    loadingBar.setAttribute("value", downloadedCount);
  }

  // 17) Download all audio media segments (if any)
  if (audioInfo) {
    for (let i = 0; i < audioInfo.segmentUrls.length; i++) {
      const segUrl  = audioInfo.segmentUrls[i];
      const segPath = audioInfo.mediaPaths[i];
      console.log(`>>> Fetching audio segment #${i + 1}:`, segUrl);
      const buf = await fetchArrayBuffer(segUrl);
      zip.file(segPath, buf);
      downloadedCount++;
      loadingBar.setAttribute("value", downloadedCount);
    }
  }

  console.log("▶️ All segments fetched; generating ZIP…");

  // 18) Generate the ZIP Blob and trigger download
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const baseName = mpdFilename.replace(/\.mpd$/i, "");
  const zipName  = `${baseName}.zip`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  console.log(`✅ Downloaded ZIP (“${zipName}”).`);
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

  // Check saved preference in localStorage
  const preference = localStorage.getItem("stream-quality"); // "highest" | "lowest" or null

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  // Build and show an MDUI dialog to let user pick one.
  return new Promise((resolve) => {
    // Create dialog root
    const dialog = document.createElement("mdui-dialog");
    dialog.headline = "Select Video Quality";

    // Content: a <div> that holds a label + <mdui-select>
    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-video-select");
    label.textContent = "Video Quality:";
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");
    select.setAttribute("id", "mpd-video-select");
    // Default to index 0
    select.value = "0";

    // Sort reps by bandwidth ascending (so “smallest” is first), just for presentation.
    const sorted = reps.slice().sort((a, b) => a.bandwidth - b.bandwidth);

    sorted.forEach((r, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const kbps = Math.round(r.bandwidth / 1000);
      option.textContent = `${r.width}×${r.height} (${kbps} kbps)`;
      select.appendChild(option);
    });

    content.appendChild(select);

    // Actions: an OK button
    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = "OK";
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const idx = parseInt(select.value, 10) || 0;
      document.body.removeChild(dialog);
      // Resolve with the chosen representation (from sorted[])
      resolve(sorted[idx]);
    });
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);
    // Open the dialog on next frame
    requestAnimationFrame(() => { dialog.open = true; });
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
async function selectMPDAudioRepresentation(reps) {
  // If there's only one rep, no need to ask.
  if (reps.length === 1) {
    return reps[0];
  }

  // Check saved preference in localStorage
  const preference = localStorage.getItem("stream-quality"); // "highest" | "lowest" or null

  if (preference === "highest") {
    return reps.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  } else if (preference === "lowest") {
    return reps.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
  }

  // Build and show an MDUI dialog to let user pick one.
  return new Promise((resolve) => {
    // Create dialog root
    const dialog = document.createElement("mdui-dialog");
    dialog.headline = "Select Audio Quality";

    // Content: a <div> that holds a label + <mdui-select>
    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-audio-select");
    label.textContent = "Audio Quality:";
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");
    select.setAttribute("id", "mpd-audio-select");
    // Default to index 0
    select.value = "0";

    // Sort reps by bandwidth ascending (so “smallest” is first), just for presentation.
    const sorted = reps.slice().sort((a, b) => a.bandwidth - b.bandwidth);

    sorted.forEach((r, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);
      const kbps = Math.round(r.bandwidth / 1000);
      option.textContent = `${kbps} kbps`;
      select.appendChild(option);
    });

    content.appendChild(select);

    // Actions: an OK button
    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = "OK";
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const idx = parseInt(select.value, 10) || 0;
      document.body.removeChild(dialog);
      // Resolve with the chosen representation (from sorted[])
      resolve(sorted[idx]);
    });
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);
    // Open the dialog on next frame
    requestAnimationFrame(() => { dialog.open = true; });
  })
}