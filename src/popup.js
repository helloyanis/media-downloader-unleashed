// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
  var browser = chrome;
}

let downloadingCount = 0;
let ratingCount = 0;
sessionStorage.setItem('shownYoutubeAlert', 0); //To prevent multiple youtube alerts in the same session

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

  checkAndShowRatingBanner()
  document.getElementById('dont-show-again-button').addEventListener('click', (event) => {
    dismissRatingBanner();
  });

  // Remind me later button
  document.getElementById('remind-me-later-button').addEventListener('click', (event) => {
    const ratingBanner = document.getElementById('rating-banner');
    ratingBanner.style.display = 'none';
    // Reset install date to now so we remind in 7 days
    localStorage.setItem('install-date', Temporal.Now.plainDateISO().toString());
  });

  document.getElementById('rate-now-button').addEventListener('click', async (event) => {
    //Check the amount of ratings before opening the page
    res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
    data = await res.json();
    ratingCount = data.ratings.count;
    console.log("Current rating count:", ratingCount);
    // Save rating count to local storage, in case the user opens a new extension window after rating
    localStorage.setItem('ratings-at-attempt', ratingCount)
    // On focus we will check if the rating count increased
    onfocus = async () => {
      res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
      data = await res.json();
      const newRatingCount = data.ratings.count;
      console.log("New rating count:", newRatingCount);
      if (newRatingCount > ratingCount) {
        // User rated, dismiss the banner
        dismissRatingBanner();
      }
      localStorage.removeItem("ratings-at-attempt")
      onfocus = null; // Remove the onfocus handler after it's been used
    };
  })

  // Check if the options page is requested
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('options') === 'true') {
    document.querySelectorAll('mdui-tab')[1].click(); //Click on the options tab
  }

});

// Check if we should show the rating banner
async function checkAndShowRatingBanner() {

  if(typeof Temporal !== 'undefined') {
    if (!localStorage.getItem('install-date')) {
      localStorage.setItem('install-date', Temporal.Now.plainDateISO().toString());
      return;
    }

    let installDate;
    try {
      installDate = Temporal.PlainDate.from(localStorage.getItem('install-date'));
    } catch (e) {
      // Fallback: older versions stored epoch-ms as a string. Fall back to today minus 7 days to show the banner immediately
      installDate = Temporal.Now.plainDateISO().subtract({ days: 7 });
      localStorage.setItem('install-date', installDate.toString());

    }
    const hasRated = localStorage.getItem('has-rated');
    const now = Temporal.Now.plainDateISO();

    const daysSinceInstall = now.since(installDate).days
  if (daysSinceInstall >= 7 && !hasRated) {
    if(localStorage.getItem("ratings-at-attempt")){
      // User has attempted to rate, check if the ratings are higher than the stored ones
      res = await fetch("https://addons.mozilla.org/api/v5/addons/addon/media-downloader-unleashed/");
      data = await res.json();
      const newRatingCount = data.ratings.count;
      const previousRatingCount = parseInt(localStorage.getItem("ratings-at-attempt"), 10);
      if (newRatingCount > previousRatingCount) {
        // User rated, do not show the banner
        return dismissRatingBanner();
      }
    }
    // Show the rating banner
    const ratingBanner = document.getElementById('rating-banner');
    ratingBanner.removeAttribute("style"); //Show the banner
  }
  } else {
    // If Temporal is not supported (Chrome), show the banner immediately
    if (!localStorage.getItem('has-rated')) {
      const ratingBanner = document.getElementById('rating-banner');
      ratingBanner.removeAttribute("style"); //Show the banner
    }
  }
}

// Dismiss the rating banner
function dismissRatingBanner() {
  const ratingBanner = document.getElementById('rating-banner');
  ratingBanner.style.display = 'none';
  localStorage.setItem('has-rated', 'true');
}


/**
 * Update the downloading count and change the title accordingly
 * @param {Number} change The change in downloading count (positive or negative)
 * @returns {void} Does not return anything, but updates the title and button states
 * */
function updateDownloadingCount(change) {
  downloadingCount += change;
  if (downloadingCount < 0) downloadingCount = 0; // Prevent negative count (should not happen but we never know ¯\_(ツ)_/¯)
  if(downloadingCount === 0) {
    document.title = "Media Downloader Unleashed!!";
    document.querySelector("#clear-list").disabled = false; //Enable clear list button when not downloading
    document.querySelector("#refresh-list").disabled = false; //Enable refresh list button when not downloading
  } else {
    document.title = `⬇️ ${downloadingCount} ⏳️`;
    document.querySelector("#clear-list").disabled = true; //Disable clear list button while downloading
    document.querySelector("#refresh-list").disabled = true; //Disable refresh list button while downloading
  }
}

/**
 * Show a dialog with a message and an optional title.
 * This function creates a dialog element, adds a title and message to it, and provides buttons for reporting an issue or closing the dialog. Used when an error occurs or when the user needs to be informed about something.
 * @param {String} message The message to display in the dialog
 * @param {String} [title=null] The title of the dialog, if not provided a random error title will be used
 * @returns {void} Does not return anything, but creates a dialog element in the DOM
*/
function showDialog(message, title = null, errorData = null) {
  const dialog = document.createElement('mdui-dialog');;
  //Add the title to the dialog
  const titleElement = document.createElement('div');
  titleElement.setAttribute('slot', 'headline');
  errorTitles = [browser.i18n.getMessage("errorTitle1"), browser.i18n.getMessage("errorTitle2"), browser.i18n.getMessage("errorTitle3"), browser.i18n.getMessage("errorTitle4"), browser.i18n.getMessage("errorTitle5"),browser.i18n.getMessage("errorTitle6")];
  if (title) {
    titleElement.textContent = title;
  } else {
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
  reportButton.textContent = browser.i18n.getMessage("reportIssue");
  reportButton.slot = 'action';
  reportButton.addEventListener('click', async () => {
    reportButton.disabled = true;
    if(!await shareDiagnosticData(errorData)) reportButton.disabled = false;
  });
  dialog.appendChild(reportButton);

  const okButton = document.createElement('mdui-button');
  okButton.variant = "text"
  okButton.textContent = browser.i18n.getMessage("okButton");
  okButton.slot = 'action';
  okButton.addEventListener('click', () => {
    dialog.removeAttribute('open');
  });
  dialog.appendChild(okButton);

  document.body.appendChild(dialog);
  dialog.setAttribute('open', true)
}

async function showDialogCustom({
  headline = "",
  description = "",
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm = () => {},
  onCancel = () => {},
  showTextField = true,
  textFieldOptions = {}
}) {
  return new Promise((resolve) => {

    const dialog = document.createElement("mdui-dialog");

    // ----- Headline -----
    const headlineElement = document.createElement("div");
    headlineElement.setAttribute("slot", "headline");
    headlineElement.textContent = headline;
    dialog.appendChild(headlineElement);

    // ----- Body ------
    const dialogBodyElement = document.createElement("div");
    dialogBodyElement.style.display = "flex";
    dialogBodyElement.style.flexDirection = "column";
    dialog.appendChild(dialogBodyElement);

    // ----- Description -----
    const descriptionElement = document.createElement("div");
    descriptionElement.setAttribute("slot", "description");
    descriptionElement.innerHTML = description;
    dialogBodyElement.appendChild(descriptionElement);

    // ----- Text Field -----
      const textField = document.createElement("mdui-text-field");
      textField.setAttribute("slot", "description");

      for (const [key, val] of Object.entries(textFieldOptions)) {
        if (val !== undefined && val !== null) {
          textField.setAttribute(key, val);
        }
      }
    if (showTextField) {
      dialogBodyElement.appendChild(textField);
    }

    // ----- Cancel Button -----
    const cancelBtn = document.createElement("mdui-button");
    cancelBtn.variant = "text";
    cancelBtn.slot = "action";
    cancelBtn.textContent = cancelText;
    cancelBtn.addEventListener("click", () => {
      dialog.removeAttribute("open");
      onCancel();
      resolve(false);
    });
    dialog.appendChild(cancelBtn);

    // ----- Confirm Button -----
    const confirmBtn = document.createElement("mdui-button");
    confirmBtn.variant = "text";
    confirmBtn.slot = "action";
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener("click", () => {
      dialog.removeAttribute("open");
      if (showTextField) {
        const value = textField.value;
        onConfirm(value);

      } else {
        onConfirm();;
      }
      resolve(true);
    });
    dialog.appendChild(confirmBtn);

    // Show dialog
    document.body.appendChild(dialog);
    dialog.setAttribute("open", true);
  });
}


async function shareDiagnosticData(errorData) {
  console.log("Sharing diagnostic data:", errorData);

  window.open(`https://docs.google.com/forms/d/e/1FAIpQLSdXpVKZaJm-Yk6DmnkFZHxPLRH4xK51uk7NeioKJ8CxZbxXVA/viewform`);

  // For some reason the Mozilla Add-on review team doesn't allow me to pre-fill the form, even though it's just to make it easier for users to report issues and doesn't force them to share any data they don't want to share. As per their e-mail :
  // > "As your extension is compatible with Firefox 139 and earlier a custom data collection collection and transmission consent screen is required in order to be compliant."
  // Even though It looked like I was already compliant? See https://furries.club/system/media_attachments/files/116/052/458/698/436/290/original/bab638f0f729bf0a.png for a screenshot.
  // Anyways now sharing error data has become a chore but hopefully this should at least make the add-on be re-listed on the store.
  
  // Below, the ideal solution which prefills the form :
  // let mediaRequests = await browser.runtime.sendMessage({ action: 'getMediaRequests' });
  // window.open(`https://docs.google.com/forms/d/e/1FAIpQLSdXpVKZaJm-Yk6DmnkFZHxPLRH4xK51uk7NeioKJ8CxZbxXVA/viewform?usp=pp_url&entry.1792028239=${encodeURIComponent(errorData.error || 'N/A')}&entry.1527093375=${encodeURIComponent(errorData.url || 'N/A')}&entry.713772415=${encodeURIComponent(mediaRequests[errorData.url]?.[0]?.requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value || 'N/A')}&entry.582473750=${encodeURIComponent(navigator.userAgent)}}`, '_blank');
}

/**
 * Load the media list from the background script and display it in the window.
 * This function retrieves media requests from the background script, filters them based on MIME types and file extensions, and displays them in a list format.
 * It's a chunky bit of code, but it does what it's supposed to so it's staying there ヾ(⌐■_■)ノ♪
 */
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
        "videoxflv",
        "videoxmsvideo",
        "videoxmswmv",
        "videoquicktime",
        "videomp4",
        "audioxpcm",
        "audiowav",
        "audiompeg",
        "audioaac",
        "audioogg",
        "audioxmswma",
        "applicationvdnapplempegurl",
        "applicationxmpegurl",
        "applicationdashxml"
      ];

      const useMimeDetection = localStorage.getItem('mime-detection') === '1';
      const useUrlDetection = localStorage.getItem('url-detection') === '1';

      let mimeMatch = false;
      let urlMatch = false;

      // Check if the request matches the media types or file extensions
      if (useMimeDetection && requests[0]?.responseHeaders) {
        mimeMatch = requests[0].responseHeaders.find(header => mediaTypes.includes(header.value.toLowerCase().replace(/[^a-zA-Z]/g, ''))) !== undefined;
      }

      const mediaURL = new URL(url);
      // Check if the request matches the file extensions
      if (useUrlDetection) {
        urlMatch = fileExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext));
      }

      //Hide segments
      const hideSegments = localStorage.getItem('hide-segments') === '1';


      // If user doesn't want to hide segments we do nothing special
      if (hideSegments) {
        // Always show playlists/manifests (.m3u8, .mpd)
        const isPlaylistExt = mediaURL.pathname.toLowerCase().endsWith('.m3u8') ||
                              mediaURL.pathname.toLowerCase().endsWith('.mpd');
        if (!isPlaylistExt) {
          // Gather response headers from the first request (if available)
          const resHeaders = requests[0]?.responseHeaders || [];
          const contentType = (resHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value || '').toLowerCase();
          const contentLengthHeader = resHeaders.find(h => h.name.toLowerCase() === 'content-length')?.value;
          const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

          // Known segment-related content-types and file extensions
          const segmentContentTypeRe = /video\/mp2t|video\/iso\.segment|application\/octet-stream|video\/x-mpegurl/i;
          const segmentExtRe = /\.(ts|m4s|m4f|seg|frag|fragment)(?:$|\?)/i;

          const looksLikeSegmentByType = contentType && segmentContentTypeRe.test(contentType);
          const looksLikeSegmentByExt = segmentExtRe.test(mediaURL.pathname);

          // If any of the tests indicate a segment, skip adding this entry
          if (looksLikeSegmentByExt || looksLikeSegmentByType) {
            // Skip segment
            console.debug('Hiding stream segment:', url, { contentType, contentLength });
            continue;
          }
        }
      }


      if (!useMimeDetection && !useUrlDetection) {
        // No filtering at all, proceed
      } else if (!(mimeMatch || urlMatch)) {
        // If neither detection matched, skip
        continue;
      }
      // If the request is from youtube, show a popup to inform the user that downloading from youtube is not supported
      if (mediaURL.hostname.includes("youtube.com") || mediaURL.hostname.includes("youtu.be")) {
        handleYoutubeMediaRequest(url);
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
      const hasResponseHeaders = requests[0]?.responseHeaders && requests[0].responseHeaders.length > 0;
      let path = document.createElementNS("http://www.w3.org/2000/svg", 'path');
      if(hasResponseHeaders) {
        if (videoExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext)) || requests[0]?.responseHeaders.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("video/"))) {
          //Media is a video
          path.setAttribute('d', 'm160-800 80 160h120l-80-160h80l80 160h120l-80-160h80l80 160h120l-80-160h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0 0v320-320Z');
        }
        else if (audioExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext)) || requests[0]?.responseHeaders.find(h => h.name.toLowerCase() === "content-type" && h.value.startsWith("audio/"))) {
          //Media is an audio
          path.setAttribute('d', 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z');
        }
        else if (streamExtensions.some(ext => mediaURL.pathname.toLowerCase().endsWith(ext)) || requests[0]?.responseHeaders.find(h => h.name.toLowerCase() === "content-type" && (h.value ==="application/x-mpegURL" || h.value ==="application/vnd.apple.mpegurl" || h.value ==="application/dash+xml"))) {
          //Media is a stream
          path.setAttribute('d', 'M40-480q0-92 34.5-172T169-791.5q60-59.5 140-94T480-920q91 0 171 34.5t140 94Q851-732 885.5-652T920-480h-80q0-75-28.5-140.5T734-735q-49-49-114.5-77T480-840q-74 0-139.5 28T226-735q-49 49-77.5 114.5T120-480H40Zm160 0q0-118 82-199t198-81q116 0 198 81t82 199h-80q0-83-58.5-141.5T480-680q-83 0-141.5 58.5T280-480h-80ZM360-64l-56-56 136-136v-132q-27-12-43.5-37T380-480q0-42 29-71t71-29q42 0 71 29t29 71q0 30-16.5 55T520-388v132l136 136-56 56-120-120L360-64Z');
        }
        else {
          //Media is unknown
          path.setAttribute('d', 'M240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z');
        }
      } else {
        //No response headers, unknown media
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
      descriptionDiv.textContent = browser.i18n.getMessage("requestText",[requests[0]?.method ?? browser.i18n.getMessage("requestMethodUnknown"), requests[0]?.requestHeaders?.find(h => h.name.toLowerCase() === "referer")?.value ?? browser.i18n.getMessage("requestSourceUnknown"), new Date(requests[0]?.timeStamp).toLocaleTimeString(browser.i18n.getUILanguage()) ?? "??:??"]);
      mediaDiv.appendChild(descriptionDiv);

      // Create a div to put actions at the end of the media item
      const actionsDiv = document.createElement('div');
      actionsDiv.style.display = 'flex';
      actionsDiv.style.alignItems = 'center';
      actionsDiv.style.flexWrap = 'wrap';
      actionsDiv.style.margin = '5px';
      mediaDiv.appendChild(actionsDiv);
      // Create a div to put the buttons in
      const segmentedButtonGroup = document.createElement('mdui-segmented-button-group');
      segmentedButtonGroup.style.display = 'flex';

      // Create a select for the media sizes
      const sizeSelect = document.createElement('mdui-select');
      sizeSelect.variant = 'outlined';
      sizeSelect.label = browser.i18n.getMessage('size');
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
        const referer = refererHeader?.value || browser.i18n.getMessage("requestSourceUnknown");
        const timeStamp = new Date(request?.timeStamp).toLocaleTimeString(browser.i18n.getUILanguage()) || "??:??"
        descriptionDiv.textContent = browser.i18n.getMessage("requestText", [request?.method || browser.i18n.getMessage("requestMethodUnknown"), referer, timeStamp]);
      });

      actionsDiv.appendChild(sizeSelect);

      actionsDiv.appendChild(segmentedButtonGroup);

      // Add a button to copy the selected media URL to the clipboard
      const copyButton = document.createElement('mdui-segmented-button');
      copyButton.textContent = browser.i18n.getMessage("copyURL");
      copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => {
          console.log('URL copied to clipboard:', url);
        }).catch((error) => {
          console.error('Error copying URL to clipboard:', error);
          showDialog(browser.i18n.getMessage("URLCopyError"), null, { error: `Error copying URL to clipboard: ${error}` });
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
      previewButton.textContent = browser.i18n.getMessage("previewMedia");
      previewButton.addEventListener('click', () => {
        const selectedValue = sizeSelect.value;
        const menuItems = Array.from(sizeSelect.querySelectorAll('mdui-menu-item'));
        const selectedSizeIndex = menuItems.findIndex(item => item.value === selectedValue);

        let isStream = streamExtensions.some(ext =>
          new URL(url).pathname.toLowerCase().endsWith(ext)
        );
        if( isStream && new URL(url).pathname.toLowerCase().endsWith('.mpd')) {
          // For MPD no need to handle stream differently, just pass the URL
          isStream = '';
        }
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
      downloadButton.textContent = browser.i18n.getMessage("downloadMedia");
      downloadButton.addEventListener('click', () => {
        downloadFile(url, mediaDiv);
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
      segmentedButtonGroup.appendChild(downloadButton);
      segmentedButtonGroup.appendChild(copyButton);
      segmentedButtonGroup.appendChild(previewButton);

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
    endOfMediaList.textContent = browser.i18n.getMessage("endOfMediaList");
    endOfMediaList.style.textAlign = 'center';
    loadingSpinner.style.display = 'none'; // Hide the loading spinner
    mediaContainer.appendChild(endOfMediaList);
  }).catch((error) => {
    console.error('Error retrieving media requests:', error);
    showDialog(browser.i18n.getMessage("listLoadError", [error]), null, { error: `Error retrieving media requests: ${error}`, requests: mediaRequests  });
  });
}

/** Handle media requests from YouTube by showing an alert once per session */
function handleYoutubeMediaRequest(url) {
  if (sessionStorage.getItem('shownYoutubeAlert') !== '1' && localStorage.getItem('show-youtube-alert') !== '0') {
    sessionStorage.setItem('shownYoutubeAlert', '1');
    showDialogCustom({
      showTextField: false,
      headline: browser.i18n.getMessage("youtubeDialogAskTitle"),
      description: browser.i18n.getMessage("youtubeDialogAskMessage"),
      confirmText: browser.i18n.getMessage("youtubeDialogAskOkButton"),
      cancelText: browser.i18n.getMessage("drmWarningCancelButton"),
      onConfirm: () => {
        // Check if the user is on PC or Android
        const isAndroid = /Android/i.test(navigator.userAgent);
        if (isAndroid) {
          // Show Seal download page on Android
          mdui.confirm({
            headline: browser.i18n.getMessage("youtubeDialogDownloaderAndroidTitle"),
            description: browser.i18n.getMessage("youtubeDialogDownloaderAndroidMessage"),
            onConfirm: () => {
              window.open('https://github.com/JunkFood02/Seal?tab=readme-ov-file#%EF%B8%8F-download', '_blank');
            }
          })
        } else {
          // Show yt-dlp page on PC
          mdui.confirm({
            headline: browser.i18n.getMessage("youtubeDialogDownloaderPCTitle"),
            description: browser.i18n.getMessage("youtubeDialogDownloaderPCMessage"),
            onConfirm: () => {
              window.open('https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#installation', '_blank');
            }
          });
        }
      },
      onCancel: () => {},
    });
    document.getElementById('youtube-dialog-dont-show-again').addEventListener('change', (event) => {
      if (event.target.checked) {
        localStorage.setItem('show-youtube-alert', '0');
      } else {
        localStorage.setItem('show-youtube-alert', '1');
      }
    })
  }
}

/**
 * Clear the media list from the local storage and refresh the display of the media list
 * @returns {null} Does not return anything, but throws on error
 */
function clearMediaList() {
  browser.runtime.sendMessage({ action: 'clearStorage' }).then(() => {
    console.log('Media list cleared');
    loadMediaList(); //Refresh the display
  }).catch((error) => {
    console.error('Error clearing media list:', error);
    showDialog(browser.i18n.getMessage("listClearError", [error]), null, { error: `Error clearing media list: ${error}`  });
  });
}

/**
 * Get the file name from the URL, limiting it to 20 characters. This is what's displayed in the media list.
 * @param {String} url The URL of the media file
 * @returns {String} The file name extracted from the URL, limited to 20 characters
*/
function getFileName(url) {
  try {
    let parsedUrl = new URL(url);

    // Extract path from URL
    let pathname = parsedUrl.pathname; // e.g. /path/to/file.mp4
    let fileName = pathname.substring(pathname.lastIndexOf('/') + 1);

    // Remove query string from file name
    fileName = fileName.split('?')[0];

    // Replace these characters with underscores as they are not allowed in Windows file names : < > : " / \ | ? * and control characters (0-31)
    fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

    //Limit to 20 characters, but still show the extension
    if (fileName.length > 20) {
      fileName = fileName.substring(0, 20) + '…' + fileName.substring(fileName.lastIndexOf('.'));
    }

    if(fileName === '') {
      fileName = parsedUrl.hostname; // If there is no file name, use the hostname
    }

    return fileName;
  } catch (error) {
    console.error("Invalid URL", error);
    throw new Error('Invalid URL:', error);
  }
}

/**
 * Convert size in bytes to a human-readable format
 * @param {Number} size Size in bytes (like 1024, 2048, etc.)
 * @returns {String} Human-readable size (e.g. "1.00 Kb", "2.00 Mb", etc.)
 */
function getHumanReadableSize(size) {
  const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
  if (isNaN(size)) {
    return browser.i18n.getMessage("unknownSize"); // Return a message if size is not a number
  }
  let unitIndex = 0;
  let sizeInBytes = parseInt(size);
  while (sizeInBytes > 1024) {
    sizeInBytes /= 1024;
    unitIndex++;
  }
  return `${sizeInBytes.toFixed(2)} ${units[unitIndex]}`;
}

/**
* Download the media file using the selected size and method
* @param {String} url The URL of the media file to download
* @param {HTMLElement} mediaDiv The div element of the list item to be downloaded, used to get the selected size, show the loading bar and change the button state
* @returns {Promise<void>} A promise that resolves when the download is complete or fails
*/
async function downloadFile(url, mediaDiv) {
  console.log('Downloading media file:', url);
  let wakeLock = null
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    console.log("Wake Lock is active!");
  } catch (err) {
    // The Wake Lock request has failed - usually system related, such as battery.
    console.warn(`Could not activate wake lock due to error ${err.name}, ${err.message}`);
  }

  // Add confirmation to leave the page while downloading
  window.addEventListener('beforeunload', beforeUnloadHandler);
  updateDownloadingCount(1);

  const sizeSelect = mediaDiv.querySelector('.media-size-select');
  const loadingBar = document.createElement('mdui-linear-progress');
  try {
    const requests = await browser.runtime.sendMessage({ action: 'getMediaRequests', url: url }); // Get the media requests for the given URL from the background script
    const forbiddenHeaders = [
      "Accept-Charset", "Accept-Encoding", "Access-Control-Request-Headers", "Access-Control-Request-Method",
      "Connection", "Content-Length", "Cookie", "Date", "DNT", "Expect", "Host", "Keep-Alive", "Origin",
      "Permissions-Policy", "Referer", "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Via"
    ]; // List of headers that should not be sent with the download request because fetch doesn't accept them
    const selectedValue = sizeSelect.value;
    const menuItems = Array.from(sizeSelect.querySelectorAll('mdui-menu-item'));
    let selectedSizeIndex = menuItems.findIndex(item => item.value === selectedValue);

    // If no size is selected, default to index 0
    if (selectedSizeIndex === -1) {
      console.warn('No size selected, defaulting to index 0');
      selectedSizeIndex = 0;
    }

    // Set the request headers for the download to the same headers that were used to fetch the media file on the site, to reproduce the same request, without the headers forbidden by the fetch api.
    if(!requests[url] || !requests[url][selectedSizeIndex] || !requests[url][selectedSizeIndex].requestHeaders) {
      throw new Error(browser.i18n.getMessage("noRequestFoundError"));
    }
    const headers = requests[url][selectedSizeIndex].requestHeaders.filter(header =>
      !forbiddenHeaders.includes(header.name) &&
      !header.name.startsWith('Sec-') &&
      !header.name.startsWith('Proxy-')
    );

    const downloadMethod = localStorage.getItem('download-method');
    const streamDownload = localStorage.getItem('stream-download');

    // Change the UI to indicate that the download is in progress
    mediaDiv.querySelector("#download-button").loading = true
    mediaDiv.querySelector("#download-button").disabled = true
    loadingBar.style.width = '100%';
    loadingBar.setAttribute('indeterminate', 'true');
    mediaDiv.appendChild(loadingBar);

    const lowerPath = new URL(url).pathname.toLowerCase();
    const isM3U8 = lowerPath.endsWith('.m3u8') || requests[url][selectedSizeIndex].responseHeaders.find(h => h.name.toLowerCase() === "content-type")?.value.toLowerCase().replace(/[^a-zA-Z]/g, '') ==="applicationxmpegurl" || requests[url][selectedSizeIndex].responseHeaders.find(h => h.name.toLowerCase() === "content-type")?.value.toLowerCase().replace(/[^a-zA-Z]/g, '') ==="applicationvndapplempegurl";
    const isMPD = lowerPath.endsWith('.mpd') || requests[url][selectedSizeIndex].responseHeaders.find(h => h.name.toLowerCase() === "content-type")?.value.toLowerCase().replace(/[^a-zA-Z]/g, '') ==="applicationdashxml";

    console.log(`MIME is : ${requests[url][selectedSizeIndex].responseHeaders.find(h => h.name.toLowerCase() === "content-type")?.value}`);

    if (streamDownload === 'offline' && isM3U8) {
      console.log('M3U8 detected → downloadM3U8Offline()');
      await downloadM3U8Offline(url, headers, downloadMethod, loadingBar, requests[url][selectedSizeIndex]);
      return;
    }

    if (streamDownload === 'offline' && isMPD) {
      console.log('MPD detected → downloadMPDOffline()');
      await downloadMPDOffline(url, headers, downloadMethod, loadingBar, requests[url][selectedSizeIndex]);
      return;
    }


    //At this point the media is not a stream or should not be treated as such, so initiate a regular download
    if (downloadMethod === 'browser') {
      // Use the browser.downloads API to download the file
      const fileName = getFileName(url) || 'media';

      browser.downloads.download({
        url,
        filename: fileName,
        headers: headers,
        method: requests[url][selectedSizeIndex].method
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
        method: requests[url][selectedSizeIndex].method,
        headers: headersObject,
        referrer: requests[url][selectedSizeIndex].requestHeaders.find(h => h.name.toLowerCase() === "referer")?.value,
        body: requests[url][selectedSizeIndex].method !== 'GET' ? requests[url][selectedSizeIndex].requestBody : null,
      });

      if (!response.ok) {
        throw new Error(`Error downloading media file with fetch: ${response.status}`);
      }

      // Get the total size from Content-Length header
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      
      // Update loading bar to show determinate progress
      loadingBar.removeAttribute('indeterminate');
      loadingBar.value = 0;

      // Read the response body as a stream to track progress
      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          chunks.push(value);
          receivedLength += value.length;
          
          // Update progress bar if we know the total size
          if (contentLength > 0) {
            const progress = receivedLength / contentLength;
            loadingBar.value = progress;
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
      a.download = getFileName(url) || 'media';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      console.log('Media file downloaded:', blobUrl);
      URL.revokeObjectURL(blobUrl); // Clean up the blob URL
    }
  } catch (error) {
    if(!navigator.onLine) {
      mdui.snackbar({
        message: browser.i18n.getMessage("offlineError"),
        autoCloseDelay: 15000,
        closeable: true,
      });
    }
    console.error('Error downloading media file:', error);
    showDialog(browser.i18n.getMessage("downloadError", [error.message]), null, { error: `Error downloading media file: ${error.message}`, url: url  });
  }
  finally {
    if (wakeLock) {
      wakeLock.release().then(() => {
        wakeLock = null;
      });
    }
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    updateDownloadingCount(-1);
    mediaDiv.removeChild(loadingBar);
    mediaDiv.querySelector("#download-button").loading = false;
    mediaDiv.querySelector("#download-button").disabled = false;
  }
}

/** * Warn the user if they try to leave the page while a download is in progress
 * @param {Event} event The beforeunload event
 */
const beforeUnloadHandler = (event) => {
  event.preventDefault();
};