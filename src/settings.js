// Check for the existence of the browser object and use chrome if not found
if (typeof browser === 'undefined') {
    var browser = chrome;
}
document.addEventListener('DOMContentLoaded', () => {
    initializeSettings();
});

async function initializeSettings() {
    // Check for detectionMethod setting in localStorage
    if(!localStorage.getItem('detection-method')) {
        browser.runtime.sendMessage({ action: 'clearStorage' });
    }
    let detectionMethod = localStorage.getItem('detection-method') || 'url';
    localStorage.setItem('detection-method', detectionMethod);

    // Select the current detectionMethod
    let detectionRadio = document.querySelector(`md-radio[value="${detectionMethod}"]`);
    if (detectionRadio) {
        detectionRadio.setAttribute('checked', true);
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

    // Add event listeners to the radio buttons
    document.querySelectorAll('md-radio').forEach(radio => {
        radio.addEventListener('change', (event) => {
            let setting = event.target.name;
            let value = event.target.value;
            if(setting === 'detection-method'){
                browser.runtime.sendMessage({ action: 'initListener' }) // Reinitialize the listener
                browser.runtime.sendMessage({ action: 'clearStorage' })
                loadMediaList()
            }
            localStorage.setItem(setting, value);
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
