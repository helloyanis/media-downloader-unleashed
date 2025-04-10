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
});
function showDialog(message, title=null) {
    const dialog = document.createElement('md-dialog');
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
    messageElement.setAttribute('slot', 'content');
    messageElement.innerHTML = message;
    dialog.appendChild(messageElement);

    //Add an buttons to the dialog
    const actionsSlot = document.createElement('div');
    actionsSlot.setAttribute('slot', 'actions');
    const reportButton = document.createElement('md-text-button');
    reportButton.textContent = 'Report Issue';
    reportButton.addEventListener('click', () => {
        browser.tabs.create({
            url: 'https://github.com/helloyanis/media-downloader-unleashed/issues',
        });
    });
    actionsSlot.appendChild(reportButton);
    dialog.appendChild(actionsSlot);

    const okButton = document.createElement('md-text-button');
    okButton.textContent = 'OK';
    okButton.addEventListener('click', () => {
        dialog.removeAttribute('open');
    });
    actionsSlot.appendChild(okButton);

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
            const mediaDiv = document.createElement('md-list-item');
            mediaDiv.classList.add('media-item');
            // mediaDiv.style.display = 'flex';
            // mediaDiv.style.flexWrap = 'wrap';
            // mediaDiv.style.flexDirection = 'row';
            // mediaDiv.style.justifyContent = 'space-between';
            // mediaDiv.style.margin = '10px';
            // mediaDiv.style.alignItems = 'center';

            // Display the media file name
            const fileName = getFileName(url) || url;
            const fileNameDiv = document.createElement('div');
            fileNameDiv.textContent = fileName;
            fileNameDiv.slot = 'headline';
            mediaDiv.appendChild(fileNameDiv);

            //Display request method and referrer
            const descriptionDiv = document.createElement('div');
            console.log(requests)
            descriptionDiv.textContent = `${requests[0]?.method ?? "Unknown"} request from ${requests[0]?.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value ?? "an unknown source"}`;
            descriptionDiv.slot = 'supporting-text';
            mediaDiv.appendChild(descriptionDiv);

            // Create a div to put actions at the end of the media item
            const actionsDiv = document.createElement('div');
            actionsDiv.slot = 'end'
            actionsDiv.style.display = 'flex';
            actionsDiv.style.flexDirection = 'row';
            actionsDiv.style.flexWrap = 'wrap';
            actionsDiv.style.maxWidth = '50vw';
            mediaDiv.appendChild(actionsDiv);
            // Create a select for the media sizes
            const sizeSelect = document.createElement('md-outlined-select');
            sizeSelect.label = 'Size';
            sizeSelect.id = url;
            sizeSelect.required = true;

            // Add options for the media sizes
            let isFirstElement = true;
            for (const request of requests) {
                const option = document.createElement('md-select-option');
                option.value = request.size;
                if (isFirstElement) {
                    option.selected = true;
                    isFirstElement = false;
                }
                const slot = document.createElement('div');
                slot.slot = 'headline';
                slot.textContent = getHumanReadableSize(request.size);
                option.appendChild(slot);
                sizeSelect.appendChild(option);
            }

            // Change description based on the selected size
            sizeSelect.addEventListener('change', () => {
                const selectedSize = sizeSelect.options[sizeSelect.selectedIndex].value;
                descriptionDiv.textContent = `${requests.find(request => request.size = selectedSize).method} request from ${requests.find(request => request.size = selectedSize).requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || "an unknown source"}`;
            });
            actionsDiv.appendChild(sizeSelect);

            // Add a button to copy the selected media URL to the clipboard
            const copyButton = document.createElement('md-outlined-button');
            copyButton.textContent = 'Copy URL';
            copyButton.style.margin = '10px';
            copyButton.addEventListener('click', () => {
                navigator.clipboard.writeText(url).then(() => {
                    console.log('URL copied to clipboard:', url);
                }).catch((error) => {
                    console.error('Error copying URL to clipboard:', error);
                    showDialog('Error copying URL to clipboard. Please try again.');
                });
            });

            // Add an icon to the copy button
            const svgNamespace = "http://www.w3.org/2000/svg";
            const copyIcon = document.createElementNS(svgNamespace, 'svg');
            copyIcon.setAttribute('slot', 'icon');
            copyIcon.setAttribute('viewBox', '0 -960 960 960');
            const path = document.createElementNS(svgNamespace, 'path');
            path.setAttribute('d', 'M300-180v-200l160 100-160 100Zm220-380q-50 0-85-35t-35-85q0-50 35-85t85-35h50v60h-50q-25 0-42.5 17.5T460-680q0 25 17.5 42.5T520-620h50v60h-50Zm110 0v-60h50q25 0 42.5-17.5T740-680q0-25-17.5-42.5T680-740h-50v-60h50q50 0 85 35t35 85q0 50-35 85t-85 35h-50Zm-110-90v-60h160v60H520Zm124 250v-80h196v-360H360v360h-80v-360q0-33 23.5-56.5T360-920h480q33 0 56.5 23.5T920-840v360q0 33-23.5 56.5T840-400H644ZM120-40q-33 0-56.5-23.5T40-120v-320q0-33 23.5-56.5T120-520h480q33 0 56.5 23.5T680-440v320q0 33-23.5 56.5T600-40H120Zm0-80h480v-320H120v320Zm480-540ZM360-280Z');
            copyIcon.appendChild(path);
            copyButton.appendChild(copyIcon);
            actionsDiv.appendChild(copyButton);

            // Add a button to preview the selected media file
            const previewButton = document.createElement('md-outlined-button');
            previewButton.textContent = 'Preview';
            previewButton.style.margin = '10px';
            previewButton.addEventListener('click', () => {
                browser.tabs.create({
                    url: browser.runtime.getURL(`/mediaPreviewer.html?mediaUrl=${url}&selectedSize=${sizeSelect.selectedIndex}&isStream=${streamExtensions.some(ext => new URL(url).pathname.toLowerCase().endsWith(ext)) ? '1' : '0'}`),
                });
            });

            // Add an icon to the preview button
            const previewIcon = document.createElementNS(svgNamespace, 'svg');
            previewIcon.setAttribute('slot', 'icon');
            previewIcon.setAttribute('viewBox', '0 -960 960 960');
            const previewPath = document.createElementNS(svgNamespace, 'path');
            previewPath.setAttribute('d', 'm380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z');
            previewIcon.appendChild(previewPath);
            previewButton.appendChild(previewIcon);
            actionsDiv.appendChild(previewButton);

            // Add a button to download the selected media file
            const downloadButton = document.createElement('md-filled-button');
            downloadButton.textContent = 'Download';
            downloadButton.style.margin = '10px';
            downloadButton.addEventListener('click', () => {
                downloadFile(url, sizeSelect, mediaDiv);
            });

            // Add an icon to the download button
            const downloadIcon = document.createElementNS(svgNamespace, 'svg');
            downloadIcon.setAttribute('slot', 'icon');
            downloadIcon.setAttribute('viewBox', '0 -960 960 960');
            const downloadPath = document.createElementNS(svgNamespace, 'path');
            downloadPath.setAttribute('d', 'M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z');
            downloadIcon.appendChild(downloadPath);
            downloadButton.appendChild(downloadIcon);
            actionsDiv.appendChild(downloadButton);

            // Add the media container to the popup
            mediaContainer.appendChild(mediaDiv);

            //Add divider
            const divider = document.createElement('md-divider');
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

        const headers = requests[url][sizeSelect.selectedIndex].requestHeaders.filter(header =>
            !forbiddenHeaders.includes(header.name) &&
            !header.name.startsWith('Sec-') &&
            !header.name.startsWith('Proxy-')
        );

        const downloadMethod = localStorage.getItem('download-method');
        const streamDownload = localStorage.getItem('stream-download');

        if (streamDownload === 'offline' &&
            (getFileName(url).endsWith('.m3u8') ||
                requests[url][sizeSelect.selectedIndex].responseHeaders.find(header => header.name.toLowerCase() === 'content-type').value.startsWith('application/') // Check if the response is a stream
            )) {
            console.log('M3U8 stream detected, converting to offline format...');
            const loadingBar = document.createElement('md-linear-progress');
            loadingBar.style.width = '100%';
            loadingBar.setAttribute('indeterminate', 'true');
            mediaDiv.appendChild(loadingBar);
            return await downloadM3U8Offline(url, headers, downloadMethod, loadingBar, requests[url][sizeSelect.selectedIndex]);
        }

        if (downloadMethod === 'browser') {
            const fileName = getFileName(url) || 'media';

            browser.downloads.download({
                url,
                filename: fileName,
                headers: headers,
                method: requests[url][sizeSelect.selectedIndex].method
            }).then((downloadId) => {
                console.log('Media file downloaded:', downloadId);
            }).catch((error) => {
                mediaDiv.removeChild(loadingBar);
                throw new Error('Error downloading media file with browser download method:', error);
            });

        } else {
            const headersObject = {};
            headers.forEach(header => {
                headersObject[header.name] = header.value;
            });

            const response = await fetch(url, {
                method: requests[url][sizeSelect.selectedIndex].method,
                headers: headersObject,
                referrer: requests[url][sizeSelect.selectedIndex].requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value
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
        }
    } catch (error) {
        console.error('Error downloading media file:', error);
        showDialog('Error downloading media file. Here\'s what went wrong: ' + error);
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

        const audioLine = lines.find(l => l.startsWith("#EXT-X-MEDIA:") && l.includes('TYPE=AUDIO'));
        const videoLineIndex = lines.findIndex(l => l.startsWith("#EXT-X-STREAM-INF"));
        const videoUri = lines[videoLineIndex + 1];

        const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

        videoUrl = videoUri.startsWith("http") ? videoUri : base + videoUri;
        if (audioLine) {
            const uriMatch = audioLine.match(/URI="([^"]+)"/);
            if (uriMatch) {
                const audioUri = uriMatch[1];
                audioUrl = audioUri.startsWith("http") ? audioUri : base + audioUri;
            }
        }
    }

    const downloadSegments = async (playlistUrl) => {
        let totalSegments = 0;
        let downloadedSegments = 0;
        const playlistText = await getText(playlistUrl);
        const base = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);

        const tsUrls = playlistText
            .split("\n")
            .filter(line => line && !line.startsWith("#"))
            .map(line => (line.startsWith("http") ? line : base + line));

        totalSegments += tsUrls.length; // ← Add to total segment count

        const segments = [];
        for (let i = 0; i < tsUrls.length; i++) {
            const res = await fetch(tsUrls[i], {
                headers: Object.fromEntries(headers.map(h => [h.name, h.value])),
                referrer: request.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
                method: request.method
            });

            const data = new Uint8Array(await res.arrayBuffer());
            segments.push(data);

            downloadedSegments++; // ← Track completed
            loadingBar.removeAttribute('indeterminate');
            loadingBar.setAttribute("value", downloadedSegments / totalSegments);
        }

        return new Blob(segments, { type: "video/mp2t" });
    };

    const videoBlob = await downloadSegments(videoUrl);
    let finalBlob = videoBlob;

    if (audioUrl) {
        //Add a message to the loading bar
        loadingBar.setAttribute('aria-label', 'Downloading audio stream...');
        console.log("Downloading separate audio stream...");
        const audioBlob = await downloadSegments(audioUrl);
        console.log(videoBlob, audioBlob)
        // Download both audio and video
        await muxAudioVideo(videoBlob, audioBlob, downloadMethod);
        loadingBar.remove();
        return
    }

    loadingBar.remove();

    const blobUrl = URL.createObjectURL(finalBlob);
    const fileName = getFileName(m3u8Url) + ".mp4";

    if (downloadMethod === "browser") {
        browser.downloads.download({ url: blobUrl, filename: fileName }).then(() => resolve()).catch(reject);
    } else {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

async function muxAudioVideo(videoBlob, audioBlob, downloadMethod) {
    //Temporary, before getting merges to work
    if (downloadMethod === "browser") {
        browser.downloads.download({ url: URL.createObjectURL(videoBlob), filename: "video.ts" }).then(() => resolve()).catch(reject);
        browser.downloads.download({ url: URL.createObjectURL(audioBlob), filename: "audio.ts" }).then(() => resolve()).catch(reject);
    } else {
        const a = document.createElement("a");
        a.href =  URL.createObjectURL(videoBlob);
        a.download = "video.ts";
        document.body.appendChild(a);
        a.click();
        a.href =  URL.createObjectURL(audioBlob);
        a.download = "audio.ts";
        a.click();
        document.body.removeChild(a);
    }
    showDialog("Merging audio and video is not supported. Please use the <a href='https://ffmpeg.org/download.html'>ffmpeg</a> command line tool to merge both audio and video.<br/>Use the following command :<br/><code>ffmpeg -i video.ts -i audio.ts -c:v copy -c:a aac -strict experimental output.mp4</code>", "Separated audio and video streams downloaded!");
}