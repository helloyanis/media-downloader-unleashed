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
    snackbar.textContent = browser.i18n.getMessage("splitDownloadWarningSnackbar")
    document.body.appendChild(snackbar);
    snackbar.addEventListener('close', () => {
      snackbar.remove();
    });
  }

  async function downloadSegments(playlistUrl) {
    const playlistText = await getText(playlistUrl);
    const lines = playlistText.split("\n").map(l => l.trim());

    // find EXT-X-MAP (init segment) and EXT-X-KEY
    const mapLine = lines.find(l => l.startsWith("#EXT-X-MAP"));
    const mapUri = mapLine ? (new URL(mapLine.match(/URI="([^"]+)"/)[1], playlistUrl)).href : null;

    let keyUri = null, ivHex = null, keyBuffer = null;
    for (const l of lines) {
      if (l.startsWith("#EXT-X-KEY")) {
        const u = l.match(/URI="([^"]+)"/);
        const iv = l.match(/IV=0x([0-9a-fA-F]+)/);
        if (u) keyUri = new URL(u[1], playlistUrl).href;
        if (iv) ivHex = iv[1];
        break;
      }
    }

    if (keyUri) {
      const keyRes = await fetch(keyUri, {
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        method: request.method
      });
      keyBuffer = await keyRes.arrayBuffer();
    }

    const segUrls = lines.filter(l => l && !l.startsWith("#")).map(l => new URL(l, playlistUrl).href);
    const parts = [];
    let container = null; // 'fmp4' | 'ts' | 'unknown'

    // Fetch and (if needed) decrypt init segment (EXT-X-MAP)
    if (mapUri) {
      let mapRes = await fetch(mapUri, {
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        method: request.method
      });
      let mapData = new Uint8Array(await mapRes.arrayBuffer());
      if (keyBuffer) {
        // Decrypt the init segment with same key/IV logic
        const iv = ivHex
          ? Uint8Array.from(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
          : (() => { const iv = new Uint8Array(16); new DataView(iv.buffer).setUint32(12, 0 /* seq for init */, false); return iv; })();
        mapData = await decryptSegment(mapData, keyBuffer, iv);
      }
      parts.push(mapData); // prepend init
      container = 'fmp4';
    }

    // download segments
    for (let i = 0; i < segUrls.length; i++) {
      const res = await fetch(segUrls[i], {
        headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
        referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        method: request.method
      });
      const arr = new Uint8Array(await res.arrayBuffer());

      // determine container type from first segment if unknown
      if (!container && i === 0) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('mp4') || ct.includes('iso') || ct.includes('fmp4')) container = 'fmp4';
        else if (arr[0] === 0x47) container = 'ts';
        else {
          // look for 'ftyp' or 'styp'
          const hdr = String.fromCharCode(...arr.slice(4, 8));
          if (hdr === 'ftyp' || hdr === 'styp') container = 'fmp4';
          else container = 'unknown';
        }
      }

      let data = arr;
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

      parts.push(data);
      // update loading bar as you already do
      loadingBar.removeAttribute('indeterminate');
      loadingBar.setAttribute("value", (i + 1) / segUrls.length);
    }

    // create final blob and extension
    if (container === 'fmp4') {
      const finalBlob = new Blob(parts, { type: "video/mp4" });
      return { blob: finalBlob, ext: '.mp4' };
    } else {
      const finalBlob = new Blob(parts, { type: "video/mp2t" });
      return { blob: finalBlob, ext: '.ts' };
    }
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

  const { blob: videoBlob, ext } = await downloadSegments(videoUrl);

  const baseFileName = getFileName(m3u8Url);
  if (audioUrl) {
    loadingBar.setAttribute('aria-label', browser.i18n.getMessage("downloadingAudioSnackbar"));
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
    const videoBlobUrl = URL.createObjectURL(videoBlob);
    const audioBlobUrl = URL.createObjectURL(audioBlob);

    if (downloadMethod === "browser") {
      await browser.downloads.download({
        url: videoBlobUrl,
        filename: `${baseFileName}_video${ext}`
      });
      await browser.downloads.download({
        url: audioBlobUrl,
        filename: `${baseFileName}_audio.mp3`
      });
    } else {
      const videoAnchor = document.createElement("a");
      videoAnchor.href = videoBlobUrl;
      videoAnchor.download = `${baseFileName}_video${ext}`;
      document.body.appendChild(videoAnchor);
      videoAnchor.click();
      document.body.removeChild(videoAnchor);

      const audioAnchor = document.createElement("a");
      audioAnchor.href = audioBlobUrl;
      audioAnchor.download = `${baseFileName}_audio.mp3`;
      document.body.appendChild(audioAnchor);
      audioAnchor.click();
      document.body.removeChild(audioAnchor);
    }
    showDialog(browser.i18n.getMessage("splitAudioVideoDownloadCompleteDescription", [baseFileName, ext]), browser.i18n.getMessage("splitAudioVideoDownloadCompleteTitle"));
    URL.revokeObjectURL(videoBlobUrl);
    URL.revokeObjectURL(audioBlobUrl); // Clean up the blob URLs
    return;
  } else {
    const videoBlobUrl = URL.createObjectURL(videoBlob);

    if (downloadMethod === "browser") {
      await browser.downloads.download({
        url: videoBlobUrl,
        filename: `${baseFileName}.${ext}`
      });
    } else {
      const videoAnchor = document.createElement("a");
      videoAnchor.href = videoBlobUrl;
      videoAnchor.download = `${baseFileName}.${ext}`;
      document.body.appendChild(videoAnchor);
      videoAnchor.click();
      document.body.removeChild(videoAnchor);
    }
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
async function selectStreamVariant(playlistLines, baseUrl) {
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
      const res = await fetch(variant.uri);
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

  const preference = localStorage.getItem("stream-quality");
  if (preference === "highest") return variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
  if (preference === "lowest") return variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));

  return new Promise((resolve) => {
    const dialog = document.createElement("mdui-dialog");
    dialog.headline = browser.i18n.getMessage("streamQualityDialogTitle")

    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.textContent = browser.i18n.getMessage("streamQualitySelectLabel")
    content.appendChild(label);

    const select = document.createElement("mdui-select");
    select.setAttribute("variant", "outlined");

    variants.forEach((v, index) => {
      const option = document.createElement("mdui-menu-item");
      option.setAttribute("value", index);

      const sizeMB = v.estimatedSize ? (v.estimatedSize / (1024 * 1024)).toFixed(2) + " MB" : "Size N/A";
      option.textContent = `${v.resolution} (${Math.round(v.bandwidth / 1000)} kbps, ${sizeMB})`;
      select.appendChild(option);
    });

    content.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "mdui-dialog-actions";

    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
    confirmBtn.setAttribute("variant", "text");
    confirmBtn.addEventListener("click", () => {
      const selectedIndex = select.value || 0;
      document.body.removeChild(dialog);
      resolve(variants[selectedIndex]);
    });

    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);
    requestAnimationFrame(() => dialog.open = true);
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
 * @param {HTMLElement} loadingBar  – the <mdui-linear-progress> element
 * @param {Object} request          – the single request object (requests[url][selectedSizeIndex])
 */
async function downloadMPDOffline(mpdUrl, headers, downloadMethod, loadingBar, request) {
  // Display a snackbar message informing the user about the separate audio stream
  const snackbar = document.createElement('mdui-snackbar');
  snackbar.setAttribute('open', true);
  snackbar.setAttribute('timeout', 10000);
  snackbar.textContent = 'Selected media is an MPEG-DASH stream. This will download the video and audio streams separately, packaged in a ZIP file, so you can play the .mpd file in the ZIP file with VLC or any other compatible player.';
  document.body.appendChild(snackbar);
  snackbar.addEventListener('close', () => {
    snackbar.remove();
  });
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

    // Grab the SegmentTemplate from the AdaptationSet:
    const setSt = asNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
    if (!setSt) {
      throw new Error("AdaptationSet missing SegmentTemplate. This isn’t a valid MPD.");
    }
    // Build a “base” segmentTemplate object from the AdaptationSet
    const baseSegTmpl = {
      media: setSt.getAttribute("media"),
      initialization: setSt.getAttribute("initialization"),
      duration: parseInt(setSt.getAttribute("duration") || "0", 10),
      timescale: parseInt(setSt.getAttribute("timescale") || "1", 10),
      startNumber: setSt.getAttribute("startNumber") !== null
        ? parseInt(setSt.getAttribute("startNumber"), 10)
        : 1,
      // (We assume no inline <SegmentTimeline>, so we don’t handle that here.)
    };

    // Now gather all <Representation> children
    const repNodes = Array.from(
      asNode.getElementsByTagNameNS(NS, "Representation")
    );
    if (repNodes.length === 0) {
      throw new Error("AdaptationSet has no Representation elements.");
    }

    const representations = repNodes.map((rNode) => {
      // See if this particular <Representation> has its own <SegmentTemplate>
      const repSt = rNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];

      // If it does, override fields; otherwise, use the set‐level template
      const tmplNode = repSt || setSt;
      const segTmpl = {
        media: tmplNode.getAttribute("media"),
        initialization: tmplNode.getAttribute("initialization"),
        duration: parseInt(tmplNode.getAttribute("duration") || baseSegTmpl.duration.toString(), 10),
        timescale: parseInt(tmplNode.getAttribute("timescale") || baseSegTmpl.timescale.toString(), 10),
        startNumber: tmplNode.getAttribute("startNumber") !== null
          ? parseInt(tmplNode.getAttribute("startNumber"), 10)
          : baseSegTmpl.startNumber,
      };

      return {
        id: rNode.getAttribute("id"),
        bandwidth: parseInt(rNode.getAttribute("bandwidth") || "0", 10),
        width: parseInt(rNode.getAttribute("width") || "0", 10),
        height: parseInt(rNode.getAttribute("height") || "0", 10),
        segmentTemplate: segTmpl
      };
    });

    // Return one object per AdaptationSet
    return {
      contentType,            // as you already determine it
      segmentTemplate: baseSegTmpl,
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
  function buildSegmentUrls(rep) {
    const tmpl = rep.segmentTemplate;
    const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);

    // Helper: replace common vars
    const substituteVars = (path, rep, extra = {}) => {
      return path
        .replace(/\$RepresentationID\$/g, rep.id)
        .replace(/\$Bandwidth\$/g, rep.bandwidth)
        .replace(/\$Number\$/g, extra.number !== undefined ? String(extra.number) : "$Number$")
        .replace(/\$Time\$/g, extra.time !== undefined ? String(extra.time) : "$Time$");
    };

    // 1) initialization
    const initPath = substituteVars(tmpl.initialization, rep, {});
    const initUrl = new URL(initPath, baseUrl).href;

    // Detect whether this template uses a SegmentTimeline (look up actual SegmentTemplate node in XML)
    // Try rep-level SegmentTemplate first, then adaptation-set level
    let repNode = Array.from(xmlDoc.getElementsByTagNameNS(NS, "Representation")).find(r => r.getAttribute("id") === rep.id);
    let tmplNode = null;
    if (repNode) {
      tmplNode = repNode.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      if (!tmplNode && repNode.parentElement) {
        tmplNode = repNode.parentElement.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
      }
    } else {
      // fallback: try to find any SegmentTemplate (safeguard)
      tmplNode = xmlDoc.getElementsByTagNameNS(NS, "SegmentTemplate")[0];
    }

    // If there is a SegmentTimeline, build start times array
    let segmentStartTimes = null; // in timescale units (same unit as $Time$ expects)
    const timelineNode = tmplNode ? tmplNode.getElementsByTagNameNS(NS, "SegmentTimeline")[0] : null;
    if (timelineNode) {
      // Parse all <S> elements in order
      const sElems = Array.from(timelineNode.getElementsByTagNameNS(NS, "S"));
      segmentStartTimes = [];
      let cursor = null;
      for (let i = 0; i < sElems.length; i++) {
        const s = sElems[i];
        const tAttr = s.getAttribute("t");
        const dAttr = s.getAttribute("d");
        const rAttr = s.getAttribute("r");

        if (!dAttr) {
          throw new Error("SegmentTimeline S element missing 'd' attribute — cannot compute segments.");
        }
        const d = parseInt(dAttr, 10);
        const r = rAttr !== null ? parseInt(rAttr, 10) : 0;

        // If explicit t appears, set cursor to it; otherwise cursor remains at previous cursor (or 0 for first)
        if (tAttr !== null) {
          cursor = parseInt(tAttr, 10);
        } else if (cursor === null) {
          cursor = 0;
        }

        // push (r + 1) start times
        const repeatCount = r + 1;
        for (let k = 0; k < repeatCount; k++) {
          segmentStartTimes.push(cursor);
          cursor += d;
        }
      }
    }

    // If template contains $Time$, use the timeline-derived times (or attempt to derive them)
    const usesTimeVar = tmpl.media && tmpl.media.indexOf("$Time$") !== -1;
    let mediaPaths = [];
    let segmentUrls = [];
    let firstIndex = tmpl.startNumber || 1;

    if (usesTimeVar) {
      if (!segmentStartTimes) {
        // If $Time$ is used but there's no SegmentTimeline, we cannot compute times.
        // As a fallback: try to compute times from duration/timescale (if duration provided).
        if (tmpl.duration && tmpl.duration > 0) {
          const segLen = tmpl.duration; // units: timescale units
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
            return (
              years * 365 * 24 * 3600 +
              months * 30 * 24 * 3600 +
              days * 24 * 3600 +
              hours * 3600 +
              minutes * 60 +
              secs
            );
          };
          const totalSec = parseISODuration(totalDurationISO);
          const segLenSec = segLen / (tmpl.timescale || 1);
          const estimatedCount = Math.ceil(totalSec / segLenSec);
          // Build times as multiples of segLen (in timescale units)
          segmentStartTimes = [];
          const segLenUnits = segLen;
          for (let i = 0; i < estimatedCount; i++) {
            segmentStartTimes.push(i * segLenUnits);
          }
        } else {
          throw new Error("Cannot compute $Time$ segments: SegmentTimeline missing and no fixed duration provided.");
        }
      }

      // Build media paths by replacing $Time$ with each start time
      for (let i = 0; i < segmentStartTimes.length; i++) {
        const t = segmentStartTimes[i];
        const mediaPath = substituteVars(tmpl.media, rep, { time: t, number: firstIndex + i });
        mediaPaths.push(mediaPath);
        segmentUrls.push(new URL(mediaPath, baseUrl).href);
      }
    } else {
      // Fallback: Number-based segment addressing
      // compute how many segments using MPD total duration and duration/timescale
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
        return (
          years * 365 * 24 * 3600 +
          months * 30 * 24 * 3600 +
          days * 24 * 3600 +
          hours * 3600 +
          minutes * 60 +
          secs
        );
      };
      const totalSec = parseISODuration(totalDurationISO);

      // segLenSec: if tmpl.duration is 0/absent this will be 0 => guard
      const segLenSec = (tmpl.duration || 0) / (tmpl.timescale || 1);
      if (!segLenSec || segLenSec <= 0) {
        throw new Error("Cannot compute number-based segments: no SegmentTimeline and duration/timescale missing or zero.");
      }

      const segmentCount = Math.ceil(totalSec / segLenSec);
      for (let i = 0; i < segmentCount; i++) {
        const number = (tmpl.startNumber || 1) + i;
        const mediaPath = substituteVars(tmpl.media, rep, { number });
        mediaPaths.push(mediaPath);
        segmentUrls.push(new URL(mediaPath, baseUrl).href);
      }
    }

    return {
      initPath,
      initUrl,
      mediaPaths,
      segmentUrls,
      firstIndex
    };
  }

  // 10) Build URLs (and relative paths) for the chosen vídeo & audio
  const videoInfo = buildSegmentUrls(chosenVideoRep, videoAdaptation);
  let audioInfo = null;
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


  // 11) Create the zip entries
  const zipEntries = [];

  // 12) Add the original MPD text as “<whatever>.mpd”
  const mpdFilename = mpdUrl.substring(mpdUrl.lastIndexOf("/") + 1); // e.g. "sintel.mpd"
  zipEntries.push({
    name: mpdFilename,
    data: new TextEncoder().encode(mpdXmlText), // client-zip accepts ArrayBuffer/Uint8Array
  });

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
      method: request.method,
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
  zipEntries.push({
    name: videoInfo.initPath, // e.g. "video/6000kbit/init.mp4"
    data: vInitBuf, // ArrayBuffer
  });
  downloadedCount++;
  loadingBar.setAttribute("value", downloadedCount);

  // 15) Download Audio Init (if any) + add to ZIP
  let aInitBuf = null;
  if (audioInfo) {
    console.log(">>> Fetching audio init:", audioInfo.initUrl);
    aInitBuf = await fetchArrayBuffer(audioInfo.initUrl);
    zipEntries.push({
      name: audioInfo.initPath, // e.g. "audio/480kbit/init.mp4"
      data: aInitBuf,
    });
    downloadedCount++;
    loadingBar.setAttribute("value", downloadedCount);
  }

  // 16) Download all video media segments
  for (let i = 0; i < videoInfo.segmentUrls.length; i++) {
    const segUrl = videoInfo.segmentUrls[i];
    const segPath = videoInfo.mediaPaths[i];
    console.log(`>>> Fetching video segment #${i + 1}:`, segUrl);
    const buf = await fetchArrayBuffer(segUrl);
    zipEntries.push({
      name: segPath,
      data: buf,
    });
    downloadedCount++;
    loadingBar.setAttribute("value", downloadedCount);
  }

  // 17) Download all audio media segments (if any)
  if (audioInfo) {
    for (let i = 0; i < audioInfo.segmentUrls.length; i++) {
      const segUrl = audioInfo.segmentUrls[i];
      const segPath = audioInfo.mediaPaths[i];
      console.log(`>>> Fetching audio segment #${i + 1}:`, segUrl);
      const buf = await fetchArrayBuffer(segUrl);
      zipEntries.push({
        name: segPath,
        data: buf,
      });
      downloadedCount++;
      loadingBar.setAttribute("value", downloadedCount);
    }
  }

  console.log("▶️ All segments fetched; generating ZIP…");

  // 18) Generate the ZIP Blob and trigger download
  const zipBlob = await downloadZip(zipEntries).blob();
  const baseName = mpdFilename.replace(/\.mpd$/i, "");
  const zipName = `${baseName}.zip`;

  if (downloadMethod === "browser") {
    // Use browser.downloads API to download the ZIP
    await browser.downloads.download({
      url: URL.createObjectURL(zipBlob),
      filename: zipName
    });
  } else {
    // Use a temporary <a> element to trigger download
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href); // Clean up the blob URL
  }

  console.log(`✅ Downloaded ZIP (“${zipName}”).`);
  showDialog(browser.i18n.getMessage("mpdDownloadCompleteTitle", [baseName]), browser.i18n.getMessage("mpdDownloadCompleteMessage"));
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
    dialog.headline = browser.i18n.getMessage("videoQualityDialogTitle");

    // Content: a <div> that holds a label + <mdui-select>
    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-video-select");
    label.textContent = browser.i18n.getMessage("videoQualitySelectLabel");
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
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
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
    dialog.headline = browser.i18n.getMessage("audioQualityDialogTitle");

    // Content: a <div> that holds a label + <mdui-select>
    const content = document.createElement("div");
    content.className = "mdui-dialog-content";
    dialog.appendChild(content);

    const label = document.createElement("label");
    label.setAttribute("for", "mpd-audio-select");
    label.textContent = browser.i18n.getMessage("audioQualitySelectLabel");;
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
    confirmBtn.textContent = browser.i18n.getMessage("okButton")
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