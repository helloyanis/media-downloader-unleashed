/*
Media Downloader Unleashed!! - https://github.com/helloyanis/media-downloader-unleashed/

Copyright © 2026 🦊 helloyanis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}
document.addEventListener('DOMContentLoaded', async () => {
    initializeSettings();

    // Share button functionality
    document.querySelector('#share-button').addEventListener('click', async () => {
        if (!navigator.share) {
            console.error('Web Share API is not supported in this browser.');
            mdui.alert({
                description: 'Web Share API is not supported in this browser. On Firefox, you can enable it by navigating to about:config and setting the preference "dom.webshare.enabled" to true.',
                headline: 'Share Not Supported'
            });
            return;
        }
        const shareData = {
            title: 'Check out Media Downloader Unleashed!!',
            text: 'Check out Media Downloader Unleashed, a free and #opensource browser extension to download videos, audios and live streams from many websites!',
            url: 'https://addons.mozilla.org/addon/media-downloader-unleashed?utm_source=inapp-share'
        };

        try {
            await navigator.share(shareData);
            console.log('Share was successful.');
        } catch (error) {
            console.error('Sharing failed:', error);
        }
    });
});

async function initializeSettings() {
    let isInitialized = false;

    let urlDetection = await browser.storage.local.get('url-detection').then((result) => result['url-detection']) || '1';
    browser.storage.local.set({ 'url-detection': urlDetection });

    let mimeDetection = await browser.storage.local.get('mime-detection').then((result) => result['mime-detection']) || '1';
    browser.storage.local.set({ 'mime-detection': mimeDetection });

    // Select the current detectionMethod
    let detectionCheckbox = document.querySelector(`mdui-switch[name="detection-method"][value="url"]`);
    if (detectionCheckbox && urlDetection === '1') {
        detectionCheckbox.setAttribute('checked', true);
    }
    detectionCheckbox = document.querySelector(`mdui-switch[name="detection-method"][value="mime"]`);
    if (detectionCheckbox && mimeDetection === '1') {
        detectionCheckbox.setAttribute('checked', true);
    }

    let mpdFix = await browser.storage.local.get('mpd-fix').then((result) => result['mpd-fix']) || '1';
    browser.storage.local.set({ 'mpd-fix': mpdFix });

    // Select the current mpdFix
    let mpdCheckbox = document.querySelector(`mdui-switch[name="mpd-fix"]`);
    if (mpdCheckbox) {
        if (mpdFix === '1') {
            mpdCheckbox.setAttribute('checked', true);
        }
    }

    // Check for downloadMethod setting
    let downloadMethod = await browser.storage.local.get('download-method').then((result) => result['download-method']) || 'fetch';
    browser.storage.local.set({ 'download-method': downloadMethod });

    // Select the current downloadMethod
    let downloadRadioGroup = document.querySelector(`mdui-radio-group[name="download-method"]`);
    if (downloadRadioGroup) {
        downloadRadioGroup.value = downloadMethod;
    }

    // Check for streamDownload setting
    let streamDownload = await browser.storage.local.get('stream-download').then((result) => result['stream-download']) || 'offline';
    browser.storage.local.set({ 'stream-download': streamDownload });

    // Select the current downloadMethod
    let streamRadioGroup = document.querySelector(`mdui-radio-group[name="stream-download"]`);
    if (streamRadioGroup) {
        streamRadioGroup.value = streamDownload;
    }

    // Check for mediaCache setting
    let mediaCache = await browser.storage.local.get('media-cache').then((result) => result['media-cache']) || '1';
    browser.storage.local.set({ 'media-cache': mediaCache });

    // Select the current mediaCache
    let mediaCacheCheckbox = document.querySelector(`mdui-switch[name="media-cache"]`);
    if (mediaCacheCheckbox) {
        if (mediaCache === '1') {
            mediaCacheCheckbox.setAttribute('checked', true);
        }
    }

    // Check for hideSegments setting
    let hideSegments = await browser.storage.local.get('hide-segments').then((result) => result['hide-segments']) || '1';
    browser.storage.local.set({ 'hide-segments': hideSegments });

    // Select the current hideSegments
    let hideSegmentsCheckbox = document.querySelector(`mdui-switch[name="hide-segments"]`);
    if (hideSegmentsCheckbox) {
        if (hideSegments === '1') {
            hideSegmentsCheckbox.setAttribute('checked', true);
        }
    }

    // Check for the opening preference
    let openPreference = await browser.storage.local.get('open-preference').then((result) => result['open-preference']) || 'tab';
    browser.storage.local.set({ 'open-preference': openPreference });

    // Select the current opening preference
    let openRadioGroup = document.querySelector(`mdui-radio-group[name="open-preference"]`);
    if (openRadioGroup) {
        openRadioGroup.value = openPreference;
    }

    // Check for the stream quality preference
    let streamQuality = await browser.storage.local.get('stream-quality').then((result) => result['stream-quality']) || 'ask';
    browser.storage.local.set({ 'stream-quality': streamQuality });
    // Select the current stream quality preference
    let qualityRadioGroup = document.querySelector(`mdui-radio-group[name="stream-quality"]`);
    if (qualityRadioGroup) {
        qualityRadioGroup.value = streamQuality;
    }

    // Add event listeners to the radio buttons
    document.querySelectorAll('mdui-radio-group').forEach(radio => {
        radio.addEventListener('change', async (event) => {
            let setting = event.target.name;
            let value = event.target.value;
            if ((value === 'window' || value === 'browser') && isInitialized) {
                document.querySelector('.mobile-incompatible-warning').open = true;
            }
            if (value !== 'browser') {
                browser.storage.local.set({ [setting]: value });
            }
            else {
                await browser.permissions.request({
                    permissions: ["downloads"]
                }).then((granted) => {
                    if (granted) {
                        browser.storage.local.set({ [setting]: value });
                    }

                })
            }

        });
    });

    // Check is the extension has permissions to access all URLs
    if (!await browser.permissions.contains({ origins: ["<all_urls>"] })) {
        requestOriginsPermission();
    }

    browser.permissions.onRemoved.addListener((removedPermissions) => {
        // Check if the 'downloads' permission was removed
        if (removedPermissions.permissions.includes("downloads")) {
            // Revert the download method to 'fetch'
            let downloadMethod = 'fetch';
            browser.storage.local.set({ 'download-method': downloadMethod });
            document.querySelector(`mdui-radio-group[name="download-method"]`).value = downloadMethod;
        }
        // Check if the 'all_urls' permission was removed
        if (removedPermissions.origins.includes("<all_urls>")) {
            requestOriginsPermission();
        }
    })

    browser.runtime.sendMessage({ action: 'initCacheListener' }); // Attempt to initialize the cache listener (will only attach if media-cache is enabled)

    // Add event listeners to the switches
    document.querySelectorAll('mdui-switch').forEach(switchElement => {
        switchElement.addEventListener('change', (event) => {
            let setting = event.target.name;
            let value = event.target.checked ? '1' : '0';
            browser.storage.local.set({ [setting]: value });
            switch (setting) {
                case 'media-cache':
                    // Re-initialize the listener to reflect changes
                    browser.runtime.sendMessage({ action: 'initCacheListener' });
                    break;
            }
        });
    });

    // Function to generate a system-based color scheme
    function generateSystemColor() {
        const rgbToHex = (r, g, b) => '#' + [r, g, b]
            .map(x => x.toString(16).padStart(2, '0')).join('')
        // Generate a color based on the system theme
        const accentColorEl = document.createElement('div');
        accentColorEl.style.backgroundColor = 'AccentColor';
        document.body.appendChild(accentColorEl);
        const bgColor = getComputedStyle(accentColorEl).backgroundColor;
        document.body.removeChild(accentColorEl);
        const rgb = bgColor.match(/\d+/g).map(Number);
        let hexColor = '#2196f3'; // Default to blue
        if (rgbToHex(rgb[0], rgb[1], rgb[2]) !== '#000000' && rgbToHex(rgb[0], rgb[1], rgb[2]) !== '#ffffff') hexColor = rgbToHex(rgb[0], rgb[1], rgb[2]);
        return hexColor;
    }

    // Check for interfaceColor setting
    let interfaceColor = await browser.storage.local.get('interfaceColor').then((result) => result.interfaceColor) || generateSystemColor();
    browser.storage.local.set({ 'interfaceColor': interfaceColor });
    mdui.setColorScheme(interfaceColor);

    // Select color picker element safely
    let colorPicker = document.querySelector('#color-picker-input');
    if (colorPicker) {
        colorPicker.value = interfaceColor;
        colorPicker.addEventListener('change', (event) => {
            mdui.setColorScheme(event.target.value);
            browser.storage.local.set({ 'interfaceColor': event.target.value });
        });
    }
    document.getElementById('loading').setAttribute("style", "display: none;");
    document.getElementById('content').removeAttribute("style");

    // Disable media cache checkbox if in private browsing mode
    if (browser.extension.inIncognitoContext) {
        document.querySelector(`mdui-switch[name="media-cache"]`).setAttribute('disabled', true);
        document.querySelector(`p[data-translate="mediaCacheExplain"]`).innerText += browser.i18n.getMessage("mediaCacheExplainPrivate");
    }

    isInitialized = true;
}

async function requestOriginsPermission() {
    // Request permissions to access all URLs
    if (await browser.storage.local.get('originPermissionDismissed').then((result) => result.originPermissionDismissed) === '1') {
        return; // If the user has dismissed the permission request, do not show it again
    }
    mdui.confirm({
        headline: browser.i18n.getMessage('permissionRequestTitle'),
        description: browser.i18n.getMessage('permissionRequestDescription'),
        confirmText: browser.i18n.getMessage('grantPermissionButton'),
        cancelText: browser.i18n.getMessage('denyPermissionButton'),
        onConfirm: async () => {
            const granted = await browser.permissions.request({ origins: ["<all_urls>"] });
            if (granted) {
                mdui.snackbar({
                    message: browser.i18n.getMessage('permissionGrantedMessage'),
                    closeable: true,
                });
            } else {
                mdui.snackbar({
                    message: browser.i18n.getMessage('permissionGrantFailedMessage'),
                    closeable: true,
                });
            }
        },
        onCancel: () => {
            browser.storage.local.set({ 'originPermissionDismissed': '1' });
            mdui.snackbar({
                message: browser.i18n.getMessage('permissionDeniedMessage'),
            });
        }
    });
}

window.navigation.addEventListener("navigate", (event) => {
    if (!new URL(event.destination.url).hash) return; // If there is no hash in the URL, do nothing
    if (document.querySelectorAll("#settings-container")[document.querySelectorAll("#settings-container").length - 1].querySelector(new URL(event.destination.url).hash)) {
        // If the user is navigating to a specific section within the settings, switch to the settings tab
        document.querySelectorAll("mdui-tab")[1].click(); // Click the settings tab
        // Highlight the relevant section
        const targetSection = document.querySelector(new URL(event.destination.url).hash).parentNode;
        if (targetSection) {
            targetSection.classList.add("highlighted");
            setTimeout(() => {
                targetSection.classList.remove("highlighted");
            }, 4000); // Remove highlight after 2 seconds
        }
    }
})
