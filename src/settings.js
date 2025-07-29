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
            title: 'Check out Live Stream Downloader Unleashed!!',
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
    // Check for detectionMethod setting in localStorage
    if (localStorage.getItem('detection-method')) {
        checkAndMigrateLegacyDetectionMethod();;
    }
    let urlDetection = localStorage.getItem('url-detection') || '1';
    localStorage.setItem('url-detection', urlDetection);

    let mimeDetection = localStorage.getItem('mime-detection') || '1';
    localStorage.setItem('mime-detection', mimeDetection);

    // Select the current detectionMethod
    let detectionCheckbox = document.querySelector(`mdui-checkbox[name="detection-method"][value="url"]`);
    if (detectionCheckbox && urlDetection === '1') {
        detectionCheckbox.setAttribute('checked', true);
    }
    detectionCheckbox = document.querySelector(`mdui-checkbox[name="detection-method"][value="mime"]`);
    if (detectionCheckbox && mimeDetection === '1') {
        detectionCheckbox.setAttribute('checked', true);
    }

    let mpdFix = localStorage.getItem('mpd-fix') || '1';
    localStorage.setItem('mpd-fix', mpdFix);

    // Select the current mpdFix
    let mpdCheckbox = document.querySelector(`mdui-checkbox[name="mpd-fix"]`);
    if (mpdCheckbox) {
        if (mpdFix === '1') {
            mpdCheckbox.setAttribute('checked', true);
        }
    }

    // Check for downloadMethod setting in localStorage
    let downloadMethod = localStorage.getItem('download-method') || 'fetch';
    localStorage.setItem('download-method', downloadMethod);

    // Select the current downloadMethod
    let downloadRadioGroup = document.querySelector(`mdui-radio-group[name="download-method"]`);
    if (downloadRadioGroup) {
        downloadRadioGroup.value = downloadMethod;
    }

    // Check for streamDownload setting in localStorage
    let streamDownload = localStorage.getItem('stream-download') || 'offline';
    localStorage.setItem('stream-download', streamDownload);

    // Select the current downloadMethod
    let streamRadioGroup = document.querySelector(`mdui-radio-group[name="stream-download"]`);
    if (streamRadioGroup) {
        streamRadioGroup.value = streamDownload;
    }

    // Check for the opening preference in localStorage
    let openPreference = localStorage.getItem('open-preference') || 'tab';
    localStorage.setItem('open-preference', openPreference);

    // Select the current opening preference
    let openRadioGroup = document.querySelector(`mdui-radio-group[name="open-preference"]`);
    if (openRadioGroup) {
        openRadioGroup.value = openPreference;
    }

    // Check for the stream quality preference in localStorage
    let streamQuality = localStorage.getItem('stream-quality') || 'ask';
    localStorage.setItem('stream-quality', streamQuality);
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
                localStorage.setItem(setting, value);
                browser.storage.local.set({ [setting]: value });
            }
            else {
                await browser.permissions.request({
                    permissions: ["downloads"]
                }).then((granted) => {
                    if (granted) {
                        localStorage.setItem(setting, value);
                        browser.storage.local.set({ [setting]: value });
                    }

                })
            }

        });
    });

    // Check is the extension has permissions to access all URLs
    if( !await browser.permissions.contains({ origins: ["<all_urls>"] })) {
        requestOriginsPermission();
    }

    browser.permissions.onRemoved.addListener((removedPermissions) => {
        // Check if the 'downloads' permission was removed
        if (removedPermissions.permissions.includes("downloads")) {
            // Revert the download method to 'fetch'
            let downloadMethod = 'fetch';
            localStorage.setItem('download-method', downloadMethod);
            browser.storage.local.set({ 'download-method': downloadMethod });
            document.querySelector(`mdui-radio-group[name="download-method"]`).value = downloadMethod;
        }
        // Check if the 'all_urls' permission was removed
        if (removedPermissions.origins.includes("<all_urls>")) {
            requestOriginsPermission();
        }
    })

    // Add event listeners to the checkboxes
    document.querySelectorAll('mdui-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            let setting = event.target.id;
            let value = event.target.checked ? '1' : '0';
            localStorage.setItem(setting, value);
            browser.storage.local.set({ [setting]: value });
        });
    });


    // Check for interfaceColor setting in localStorage
    let interfaceColor = localStorage.getItem('interfaceColor') || '#2196f3';
    localStorage.setItem('interfaceColor', interfaceColor);
    mdui.setColorScheme(interfaceColor);

    // Select color picker element safely
    let colorPicker = document.querySelector('#color-picker-input');
    if (colorPicker) {
        colorPicker.value = interfaceColor;
        colorPicker.addEventListener('change', (event) => {
            mdui.setColorScheme(event.target.value);
            localStorage.setItem('interfaceColor', event.target.value);
        });
    }
    document.getElementById('loading').setAttribute("style", "display: none;");
    document.getElementById('content').removeAttribute("style");
    isInitialized = true;
}

async function checkAndMigrateLegacyDetectionMethod() {
    // Check if the legacy detection method is set in localStorage
    let legacyDetectionMethod = localStorage.getItem('detection-method')
    if (legacyDetectionMethod) {
        // Migrate to the new detection method
        localStorage.setItem('url-detection', legacyDetectionMethod === 'url' ? '1' : '0');
        localStorage.setItem('mime-detection', legacyDetectionMethod === 'mime' ? '1' : '0');
        localStorage.removeItem('detection-method'); // Remove the legacy detection method

        //Show dialog to the user
        const dialog = document.createElement('mdui-dialog');
        dialog.setAttribute('open', true);
        const titleElement = document.createElement('div');
        titleElement.setAttribute('slot', 'headline');
        titleElement.textContent = 'Detection Method Migration';
        dialog.appendChild(titleElement);

        //Add the message to the dialog
        const messageElement = document.createElement('div');
        messageElement.setAttribute('slot', 'content');
        messageElement.textContent = "There has been an update to how the detection method works You can now enable multiple detection methods at the same time. Your previous detection method settings were updated. Please check the settings to ensure everything is set up correctly.";
        dialog.appendChild(messageElement);
        // Add the action buttons to the dialog
        const actionsSlot = document.createElement('div');
        actionsSlot.setAttribute('slot', 'actions');
        const reportButton = document.createElement('mdui-text-button');
        reportButton.textContent = 'Open settings';
        reportButton.addEventListener('click', () => {
            document.querySelectorAll("mdui-primary-tab")[1].click(); // Click the settings tab
            dialog.removeAttribute('open'); // Close the dialog
        });
        actionsSlot.appendChild(reportButton);
        dialog.appendChild(actionsSlot);

        const okButton = document.createElement('mdui-text-button');
        okButton.textContent = 'OK';
        okButton.addEventListener('click', () => {
            dialog.removeAttribute('open');
        });
        actionsSlot.appendChild(okButton);

        document.body.appendChild(dialog);
    }
}

async function requestOriginsPermission() {
    // Request permissions to access all URLs
    if (localStorage.getItem('originPermissionDismissed') === '1') {
        return; // If the user has dismissed the permission request, do not show it again
    }
    mdui.confirm({
        headline: 'Permission Required',
        description: 'The extension needs permission to access all URLs to function properly. This is in order to detect media from all websites. Your browsing data is only stored on your device, and not shared with anyone. Please grant the permission, or if you know what you are doing and want scoped storage, you can dismiss this warning.',
        confirmText: 'Grant Permission',
        cancelText: "Don't remind me",
        onConfirm: async () => {
            const granted = await browser.permissions.request({ origins: ["<all_urls>"] });
            if (granted) {
                mdui.snackbar({
                    message: 'Permission granted successfully.',
                    closeable: true,
                });
            } else {
                mdui.snackbar({
                    message: 'Permission denied. The extension may not work as expected.',
                    closeable: true,
                });
            }
        },
        onCancel: () => {
            localStorage.setItem('originPermissionDismissed', '1');
            mdui.snackbar({
                message: 'Permission not granted. The extension may not work as expected.',
            });
        }
    });
}