// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}
document.addEventListener('DOMContentLoaded', () => {
    initializeSettings();
});

async function initializeSettings() {
    // Check for detectionMethod setting in localStorage
    if (localStorage.getItem('detection-method')) {
        checkAndMigrateLegacyDetectionMethod();;
    }
    let urlDetection = localStorage.getItem('url-detection') || '1';
    localStorage.setItem('url-detection', urlDetection);

    let mimeDetection = localStorage.getItem('mime-detection') || '1';
    localStorage.setItem('mime-detection', mimeDetection);

    // Select the current detectionMethod
    let detectionCheckbox = document.querySelector(`md-checkbox[name="detection-method"][value="${urlDetection == 1 ? 'url' : 'mime'}"]`);
    if (detectionCheckbox) {
        detectionCheckbox.setAttribute('checked', true);
    }

    // Check for downloadMethod setting in localStorage
    let downloadMethod = localStorage.getItem('download-method') || 'fetch';
    localStorage.setItem('download-method', downloadMethod);

    // Select the current downloadMethod
    let downloadRadio = document.querySelector(`md-radio[value="${downloadMethod}"]`);
    if (downloadRadio) {
        downloadRadio.setAttribute('checked', true);
    }

    // Check for streamDownload setting in localStorage
    let streamDownload = localStorage.getItem('stream-download') || 'stream';
    localStorage.setItem('stream-download', streamDownload);

    // Select the current downloadMethod
    let streamRadio = document.querySelector(`md-radio[value="${streamDownload}"]`);
    if (streamRadio) {
        streamRadio.setAttribute('checked', true);
    }

    // Check for the opening preference in localStorage
    let openPreference = localStorage.getItem('open-preference') || 'tab';
    localStorage.setItem('open-preference', openPreference);

    // Select the current opening preference
    let openRadio = document.querySelector(`md-radio[value="${openPreference}"]`);
    if (openRadio) {
        openRadio.setAttribute('checked', true);
    }

    // Add event listeners to the radio buttons
    document.querySelectorAll('md-radio').forEach(radio => {
        radio.addEventListener('change', (event) => {
            let setting = event.target.name;
            let value = event.target.value;
            localStorage.setItem(setting, value);
            browser.storage.local.set({ [setting]: value });
        });
    });

    // Add event listeners to the checkboxes
    document.querySelectorAll('md-checkbox').forEach(checkbox => {
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
    document.documentElement.style.setProperty('--md-sys-color-primary', interfaceColor);
    document.documentElement.style.setProperty('--md-sys-color-secondary', interfaceColor);

    // Select color picker element safely
    let colorPicker = document.querySelector('#color-picker-input');
    if (colorPicker) {
        colorPicker.value = interfaceColor;
        colorPicker.addEventListener('change', (event) => {
            let color = event.target.value;
            document.documentElement.style.setProperty('--md-sys-color-primary', color);
            document.documentElement.style.setProperty('--md-sys-color-secondary', color);
            localStorage.setItem('interfaceColor', color);
        });
    }
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
        const dialog = document.createElement('md-dialog');
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
        const reportButton = document.createElement('md-text-button');
        reportButton.textContent = 'Open settings';
        reportButton.addEventListener('click', () => {
            document.querySelectorAll("md-primary-tab")[1].click(); // Click the settings tab
            dialog.removeAttribute('open'); // Close the dialog
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
}