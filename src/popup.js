// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}
document.addEventListener('DOMContentLoaded', () => {
    loadMediaList();
    document.getElementById('navbar').addEventListener('change', (event) => {
        console.log(event)
        const selectedTabIndex = document.getElementById('navbar').activeTabIndex;
        document.querySelectorAll('.tab-content').forEach((tabContent, index) => {
            tabContent.style.display = index === selectedTabIndex ? 'block' : 'none';
        });
    });

    document.getElementById('refresh-list').addEventListener('click', (event) => {
        loadMediaList();
    });
    document.getElementById('clear-list').addEventListener('click', (event) => {
        clearMediaList();
    });
});
function showDialog(message, title=null) {
    const dialog = document.createElement('mdui-dialog');
    dialog.setAttribute('open', true);
    //Add the title to the dialog
    const titleElement = document.createElement('div');
    titleElement.setAttribute('slot', 'headline');
    errorTitles = ["Something went wrong!", "Oops!", "Uh oh!", "Error!", "Annnd it broke!", "Oh no!"];
    if(title) {
        titleElement.textContent = title;
    }else {
        titleElement.textContent = errorTitles[~~(Math.random() * errorTitles.length)];
    }
    
    dialog.appendChild(titleElement);

    //Add the message to the dialog
    const messageElement = document.createElement('div');
    messageElement.setAttribute('slot', 'description');
    messageElement.innerHTML = message;
    dialog.appendChild(messageElement);

    //Add an buttons to the dialog
    const reportButton = document.createElement('mdui-button');
    reportButton.variant = "text"
    reportButton.textContent = 'Report Issue';
    reportButton.slot = 'action';
    reportButton.addEventListener('click', () => {
        browser.tabs.create({
            url: 'https://github.com/helloyanis/media-downloader-unleashed/issues',
        });
    });
    dialog.appendChild(reportButton);

    const okButton = document.createElement('mdui-button');
    okButton.variant = "text"
    okButton.textContent = 'OK';
    okButton.slot = 'action';
    okButton.addEventListener('click', () => {
        dialog.removeAttribute('open');
    });
    dialog.appendChild(okButton);

    document.body.appendChild(dialog);
}



function loadMediaList() {
    // Display a loading spinner while the media requests are being retrieved
    const mediaContainer = document.getElementById('media-list');
    const loadingSpinner = document.getElementById('loading-media-list');
    loadingSpinner.style.display = 'block';
    mediaContainer.innerHTML = ''; // Clear previous content
    // Send a message to the background script to get media requests
    browser.runtime.sendMessage({ action: 'getMediaRequests' }).then((mediaRequests) => {
        // Iterate over the media requests and display them
        console.log('Media requests:', mediaRequests);
        for (const url in mediaRequests) {
            const requests = mediaRequests[url];
            //If no content type or wrong content type, skip
            const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"]
            const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
            const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];

            const fileExtensions = [...videoExtensions, ...audioExtensions, ...streamExtensions];

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

            const useMimeDetection = localStorage.getItem('mime-detection') === '1';
            const useUrlDetection = localStorage.getItem('url-detection') === '1';

            let mimeMatch = false;
            let urlMatch = false;

            // Check if the request matches the media types or file extensions
            if (useMimeDetection && requests[0]?.responseHeaders) {
                mimeMatch = requests[0].responseHeaders.find(header => mediaTypes.includes(header.value)) !== undefined;
            }

            const mediaURL = new URL(url);
            // Check if the request matches the file extensions
            if (useUrlDetection) {
                urlMatch = fileExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext));
            }
            //Hide .ts segments
            if (mediaURL.pathname.toLowerCase().endsWith(".ts")) {
                continue;
            }

            if (!useMimeDetection && !useUrlDetection) {
                // No filtering at all, proceed
            } else if (!(mimeMatch || urlMatch)) {
                // If neither detection matched, skip
                continue;
            }
            // Create a container for each media request
            const mediaDiv = document.createElement('mdui-list-item');
            mediaDiv.setAttribute('nonclickable', 'true');
            mediaDiv.classList.add('media-item');
            
            // Add an icon to the media item
            const mediaIcon = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
            const mediaIconContainer = document.createElement('mdui-icon');
            mediaIconContainer.setAttribute('slot', 'icon');
            let path = document.createElementNS("http://www.w3.org/2000/svg", 'path');
            if(videoExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext))) {
                //Media is a video
                path.setAttribute('d', 'm160-800 80 160h120l-80-160h80l80 160h120l-80-160h80l80 160h120l-80-160h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0 0v320-320Z');
            }
            else if(audioExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext))) {
                //Media is an audio
                path.setAttribute('d', 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z');
            }
            else if(streamExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext))) {
                //Media is a stream
                path.setAttribute('d', 'M40-480q0-92 34.5-172T169-791.5q60-59.5 140-94T480-920q91 0 171 34.5t140 94Q851-732 885.5-652T920-480h-80q0-75-28.5-140.5T734-735q-49-49-114.5-77T480-840q-74 0-139.5 28T226-735q-49 49-77.5 114.5T120-480H40Zm160 0q0-118 82-199t198-81q116 0 198 81t82 199h-80q0-83-58.5-141.5T480-680q-83 0-141.5 58.5T280-480h-80ZM360-64l-56-56 136-136v-132q-27-12-43.5-37T380-480q0-42 29-71t71-29q42 0 71 29t29 71q0 30-16.5 55T520-388v132l136 136-56 56-120-120L360-64Z');
            }
            else {
                //Media is unknown
                path.setAttribute('d', 'M240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z');
            }
            mediaIcon.setAttribute('viewBox', '0 -960 960 960');
            mediaIcon.appendChild(path);
            mediaIconContainer.appendChild(mediaIcon);
            mediaDiv.appendChild(mediaIconContainer);


            // Display the media file name
            const fileName = getFileName(url) || url;
            const fileNameDiv = document.createElement('div');
            fileNameDiv.textContent = fileName;
            mediaDiv.appendChild(fileNameDiv);

            //Display request method and referrer
            const descriptionDiv = document.createElement('div');
            console.log(requests)
            descriptionDiv.textContent = `${requests[0]?.method ?? "Unknown"} request from ${requests[0]?.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value ?? "an unknown source"}`;
            mediaDiv.appendChild(descriptionDiv);

            // Create a div to put actions at the end of the media item
            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.justifyContent = 'space-between';
            actionsDiv.style.alignItems = 'center';
            actionsDiv.style.flexWrap = 'wrap';
            actionsDiv.style.width = '100%';
            actionsDiv.style.margin = '5px';
            mediaDiv.appendChild(actionsDiv);
            // Create a div to put the buttons in
            const segmentedButtonGroup = document.createElement('mdui-segmented-button-group');
            segmentedButtonGroup.style.display = 'flex';

            // Create a select for the media sizes
            const sizeSelect = document.createElement('mdui-select');
            sizeSelect.variant = 'outlined';
            sizeSelect.label = 'Size';
            sizeSelect.style.width = 'auto';
            sizeSelect.id = url;
            sizeSelect.classList.add('media-size-select');

            // Add options for the media sizes
            let isFirstElement = true;
            for (const request of requests) {
                const option = document.createElement('mdui-menu-item');
                option.value = request.size;
                option.textContent = getHumanReadableSize(request.size);
                if (isFirstElement) {
                    sizeSelect.value = request.size;
                    isFirstElement = false;
                }
                sizeSelect.appendChild(option);
            }

            // Change description based on the selected size
            sizeSelect.addEventListener('change', () => {
                const selectedSize = sizeSelect.value;
                const request = requests.find(request => request.size === selectedSize);
                const refererHeader = request?.requestHeaders.find(h => h.name.toLowerCase() === "referer");
                const referer = refererHeader?.value || "an unknown source";
                descriptionDiv.textContent = `${request?.method || 'Unknown'} request from ${referer}`;
            });

            actionsDiv.appendChild(sizeSelect);

            actionsDiv.appendChild(segmentedButtonGroup);

            // Add a button to copy the selected media URL to the clipboard
            const copyButton = document.createElement('mdui-segmented-button');
            copyButton.textContent = 'Copy URL';
            copyButton.addEventListener('click', () => {
                navigator.clipboard.writeText(url).then(() => {
                    console.log('URL copied to clipboard:', url);
                }).catch((error) => {
                    console.error('Error copying URL to clipboard:', error);
                    showDialog('Error copying URL to clipboard. Please try again.');
                });
            });

            // Add an icon to the copy button
            const mduiCopyIconContainer = document.createElement('mdui-icon');
            mduiCopyIconContainer.setAttribute('slot', 'icon');
            const svgNamespace = "http://www.w3.org/2000/svg";
            const copyIcon = document.createElementNS(svgNamespace, 'svg');
            copyIcon.setAttribute('viewBox', '0 -960 960 960');
            path = document.createElementNS(svgNamespace, 'path');
            path.setAttribute('d', 'M300-180v-200l160 100-160 100Zm220-380q-50 0-85-35t-35-85q0-50 35-85t85-35h50v60h-50q-25 0-42.5 17.5T460-680q0 25 17.5 42.5T520-620h50v60h-50Zm110 0v-60h50q25 0 42.5-17.5T740-680q0-25-17.5-42.5T680-740h-50v-60h50q50 0 85 35t35 85q0 50-35 85t-85 35h-50Zm-110-90v-60h160v60H520Zm124 250v-80h196v-360H360v360h-80v-360q0-33 23.5-56.5T360-920h480q33 0 56.5 23.5T920-840v360q0 33-23.5 56.5T840-400H644ZM120-40q-33 0-56.5-23.5T40-120v-320q0-33 23.5-56.5T120-520h480q33 0 56.5 23.5T680-440v320q0 33-23.5 56.5T600-40H120Zm0-80h480v-320H120v320Zm480-540ZM360-280Z');
            copyIcon.appendChild(path);
            mduiCopyIconContainer.appendChild(copyIcon);
            copyButton.appendChild(mduiCopyIconContainer);

            // Add a button to preview the selected media file
            const previewButton = document.createElement('mdui-segmented-button');
            previewButton.textContent = 'Preview';
            previewButton.addEventListener('click', () => {
                const selectedValue = sizeSelect.value;
                const menuItems = Array.from(sizeSelect.querySelectorAll('mdui-menu-item'));
                const selectedSizeIndex = menuItems.findIndex(item => item.value === selectedValue);

                const isStream = streamExtensions.some(ext =>
                    new URL(url).pathname.toLowerCase().endsWith(ext)
                );
                browser.tabs.create({
                    url: browser.runtime.getURL(`/mediaPreviewer.html?mediaUrl=${url}&selectedSize=${selectedSizeIndex}&isStream=${isStream}`),
                });
            });

            // Add an icon to the preview button
            const mduiPreviewIconContainer = document.createElement('mdui-icon');
            mduiPreviewIconContainer.setAttribute('slot', 'icon');
            const previewIcon = document.createElementNS(svgNamespace, 'svg');
            previewIcon.setAttribute('viewBox', '0 -960 960 960');
            const previewPath = document.createElementNS(svgNamespace, 'path');
            previewPath.setAttribute('d', 'm380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z');
            previewIcon.appendChild(previewPath);
            mduiPreviewIconContainer.appendChild(previewIcon);
            previewButton.appendChild(mduiPreviewIconContainer);

            // Add a button to download the selected media file
            const downloadButton = document.createElement('mdui-segmented-button');
            downloadButton.textContent = 'Download';
            downloadButton.addEventListener('click', () => {
                downloadFile(url, sizeSelect, mediaDiv);
            });
            downloadButton.id = 'download-button';

            // Add an icon to the download button
            const mduiDownloadIconContainer = document.createElement('mdui-icon');
            mduiDownloadIconContainer.setAttribute('slot', 'icon');
            const downloadIcon = document.createElementNS(svgNamespace, 'svg');
            downloadIcon.setAttribute('viewBox', '0 -960 960 960');
            const downloadPath = document.createElementNS(svgNamespace, 'path');
            downloadPath.setAttribute('d', 'M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z');
            downloadIcon.appendChild(downloadPath);
            mduiDownloadIconContainer.appendChild(downloadIcon);
            downloadButton.appendChild(mduiDownloadIconContainer);

            // Append the buttons to the actions div
            segmentedButtonGroup.appendChild(copyButton);
            segmentedButtonGroup.appendChild(previewButton);
            segmentedButtonGroup.appendChild(downloadButton);

            // Append the size select and actions div to the media item
            mediaDiv.appendChild(actionsDiv);

            // Add the media container to the popup
            mediaContainer.appendChild(mediaDiv);

            //Add divider
            const divider = document.createElement('mdui-divider');
            mediaContainer.appendChild(divider);
        }
        endOfMediaList = document.createElement('div');
        endOfMediaList.setAttribute("id", "end-of-media-list");
        endOfMediaList.textContent = "That's all we could find! If you don't see the media you're looking for, try starting the media then refreshing the list. If you still don't see it, change media detection method in the settings.";
        endOfMediaList.style.textAlign = 'center';
        loadingSpinner.style.display = 'none'; // Hide the loading spinner
        mediaContainer.appendChild(endOfMediaList);
    }).catch((error) => {
        console.error('Error retrieving media requests:', error);
        showDialog('Error retrieving media requests. Here\'s what went wrong: ' + error);
    });
}

function clearMediaList() {
    // Clear the media list in the local storage
    browser.runtime.sendMessage({ action: 'clearStorage' }).then(() => {    
        console.log('Media list cleared');
        loadMediaList();
    }).catch((error) => {
        console.error('Error clearing media list:', error);
        showDialog('Error clearing media list. Here\'s what went wrong: ' + error);
    });
}

function getFileName(url) {
    try {
        let parsedUrl = new URL(url);

        // Extract path from URL
        let pathname = parsedUrl.pathname; // e.g. /path/to/file.mp4
        let fileName = pathname.substring(pathname.lastIndexOf('/') + 1);

        // Remove query string from file name
        fileName = fileName.split('?')[0];

        //Limit to 20 characters, but still show the extension
        if (fileName.length > 20) {
            fileName = fileName.substring(0, 20) + '…' + fileName.substring(fileName.lastIndexOf('.'));
        }
        return fileName;
    } catch (error) {
        console.error("Invalid URL", error);
        throw new Error('Invalid URL:', error);
    }
}

function getHumanReadableSize(size) {
    const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
    if (isNaN(size)) {
        return "Unknown size";
    }
    let unitIndex = 0;
    let sizeInBytes = parseInt(size);
    while (sizeInBytes > 1024) {
        sizeInBytes /= 1024;
        unitIndex++;
    }
    return `${sizeInBytes.toFixed(2)} ${units[unitIndex]}`;
}

async function downloadFile(url, sizeSelect, mediaDiv) {
    console.log('Downloading media file:', url);
    try {
        const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url });
        const forbiddenHeaders = [
            "Accept-Charset", "Accept-Encoding", "Access-Control-Request-Headers", "Access-Control-Request-Method",
            "Connection", "Content-Length", "Cookie", "Date", "DNT", "Expect", "Host", "Keep-Alive", "Origin",
            "Permissions-Policy", "Referer", "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Via"
        ];
        const selectedValue = sizeSelect.value;
        const menuItems = Array.from(sizeSelect.querySelectorAll('mdui-menu-item'));
        const selectedSizeIndex = menuItems.findIndex(item => item.value === selectedValue);

        const headers = requests[url][selectedSizeIndex].requestHeaders.filter(header =>
            !forbiddenHeaders.includes(header.name) &&
            !header.name.startsWith('Sec-') &&
            !header.name.startsWith('Proxy-')
        );

        const downloadMethod = localStorage.getItem('download-method');
        const streamDownload = localStorage.getItem('stream-download');
        const loadingBar = document.createElement('mdui-linear-progress');
        mediaDiv.querySelector("#download-button").loading=true
        mediaDiv.querySelector("#download-button").disabled=true
        loadingBar.style.width = '100%';
        loadingBar.setAttribute('indeterminate', 'true');
        mediaDiv.appendChild(loadingBar);

        if (streamDownload === 'offline' &&
            (getFileName(url).endsWith('.m3u8') ||
                requests[url][selectedSizeIndex].responseHeaders.find(header => header.name.toLowerCase() === 'content-type').value.startsWith('application/') // Check if the response is a stream
            )) {
            console.log('M3U8 stream detected, converting to offline format...');
            await downloadM3U8Offline(url, headers, downloadMethod, loadingBar, requests[url][selectedSizeIndex]);
            mediaDiv.removeChild(loadingBar);
            mediaDiv.querySelector("#download-button").loading=false
            mediaDiv.querySelector("#download-button").disabled=false
            return;
        }

        if (downloadMethod === 'browser') {
            const fileName = getFileName(url) || 'media';

            browser.downloads.download({
                url,
                filename: fileName,
                headers: headers,
                method: requests[url][selectedSizeIndex].method
            }).then((downloadId) => {
                console.log('Media file downloaded:', downloadId);
                mediaDiv.removeChild(loadingBar);
                mediaDiv.querySelector("#download-button").loading=false
                mediaDiv.querySelector("#download-button").disabled=false
            }).catch((error) => {
                mediaDiv.removeChild(loadingBar);
                mediaDiv.querySelector("#download-button").loading=false
                mediaDiv.querySelector("#download-button").disabled=false
                throw new Error('Error downloading media file with browser download method:', error);

            });

        } else {
            const headersObject = {};
            headers.forEach(header => {
                headersObject[header.name] = header.value;
            });

            const response = await fetch(url, {
                method: requests[url][selectedSizeIndex].method,
                headers: headersObject,
                referrer: requests[url][selectedSizeIndex].requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value
            });

            if (!response.ok) {
                throw new Error(`Error downloading media file with fetch: ${response.status}`);
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = getFileName(url) || 'media';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            console.log('Media file downloaded:', blobUrl);
            mediaDiv.removeChild(loadingBar);
            mediaDiv.querySelector("#download-button").loading=false
            mediaDiv.querySelector("#download-button").disabled=false
            URL.revokeObjectURL(blobUrl); // Clean up the blob URL
        }
    } catch (error) {
        console.error('Error downloading media file:', error);
        showDialog('Error downloading media file. Here\'s what went wrong: ' + error);
        mediaDiv.removeChild(loadingBar);
        mediaDiv.querySelector("#download-button").loading=false
        mediaDiv.querySelector("#download-button").disabled=false
    }
}

/**
 * Downloads and converts an M3U8 stream to an MP4 file for offline use.
 * Uses either browser.downloads API or fetch depending on the download method.
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

    if (variants.length === 1) {
        // Only one variant available, no need to ask the user
        return variants[0];
    }
    const preference = localStorage.getItem("stream-quality");

    if (preference === "highest") {
        return variants.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
    } else if (preference === "lowest") {
        return variants.reduce((a, b) => (a.bandwidth < b.bandwidth ? a : b));
    }

    // Build the UI dynamically using createElement
    return new Promise((resolve) => {
        const dialog = document.createElement("mdui-dialog");
        dialog.headline="Select Stream Quality";

        const content = document.createElement("div");
        content.className = "mdui-dialog-content";
        dialog.appendChild(content);

        const label = document.createElement("label");
        label.setAttribute("for", "stream-quality-select");
        label.textContent = "Quality:";
        content.appendChild(label);

        const select = document.createElement("mdui-select");
        select.setAttribute("variant", "outlined");
        select.setAttribute("id", "stream-quality-select");
        select.value = "0"; // Default to the first option

        variants.forEach((v, index) => {
            const option = document.createElement("mdui-menu-item");
            option.setAttribute("value", index);
            option.textContent = `${v.resolution} (${Math.round(v.bandwidth / 1000)} kbps)`;
            select.appendChild(option);
        });

        content.appendChild(select);

        const actions = document.createElement("div");
        actions.className = "mdui-dialog-actions";

        const confirmBtn = document.createElement("mdui-button");
        confirmBtn.textContent = "OK";
        confirmBtn.setAttribute("variant", "text");
        confirmBtn.addEventListener("click", () => {
            const selectedIndex = select.value || 0;
            document.body.removeChild(dialog);
            resolve(variants[selectedIndex]);
        });

        actions.appendChild(confirmBtn);
        dialog.appendChild(actions);

        document.body.appendChild(dialog);

        // Trigger the dialog
        requestAnimationFrame(() => dialog.open = true);
    });
}
