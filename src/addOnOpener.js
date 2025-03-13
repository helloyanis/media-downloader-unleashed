// This file is used to open the popup.html file when the add-on icon is clicked, and to open the installed.md and when the add-on is installed.
browser.action.onClicked.addListener((tab) => {
    browser.tabs.create({
        url: browser.runtime.getURL(`${document.location.origin}/popup.html`),
    });
});

browser.runtime.onInstalled.addListener(() => {
    browser.tabs.create({
        url: `https://github.com/helloyanis/media-downloader-unleashed/blob/master/src/installed.md`,
    });
});