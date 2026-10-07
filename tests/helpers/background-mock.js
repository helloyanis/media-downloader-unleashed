// Fake WebExtension API for the background scripts (detector.js, downloader.js), run in the page before them.
// Event listeners are kept in window.__listeners[eventName], the files saved with browser.downloads in window.__downloads (with their size and first byte),
// the link clicks that start a download in window.__linkDownloads, the revoked blob URLs in window.__revoked, and the response filters in window.__filters[requestId].
// browser.downloads.download rejects when window.__rejectDownloads is set, and browser.downloads.search reports the downloads as window.__downloadState (default in_progress).
(() => {
  window.__listeners = {};
  window.__downloads = [];
  window.__linkDownloads = [];
  window.__revoked = [];
  window.__filters = {};

  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => { window.__revoked.push(url); revokeObjectURL(url); };
  HTMLAnchorElement.prototype.click = function () { window.__linkDownloads.push(this.download); };

  const event = (name) => ({
    addListener: (listener) => { (window.__listeners[name] ||= []).push(listener); },
    removeListener: (listener) => { window.__listeners[name] = (window.__listeners[name] || []).filter((l) => l !== listener); },
    hasListener: (listener) => (window.__listeners[name] || []).includes(listener),
  });
  const storageArea = (data) => ({
    get: async (keys, callback) => {
      const names = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const result = Object.fromEntries(names.filter((name) => name in data).map((name) => [name, data[name]]));
      callback?.(result);
      return result;
    },
    set: async (items, callback) => { Object.assign(data, items); callback?.(); },
    remove: async (keys, callback) => { [].concat(keys).forEach((key) => delete data[key]); callback?.(); },
  });

  window.__local = { 'force-device-type': 'desktop', 'media-cache': '1', 'media-cache-private': '0' };
  window.__session = {};

  window.browser = {
    runtime: {
      onMessage: event('runtime.onMessage'),
      onStartup: event('runtime.onStartup'),
      onInstalled: event('runtime.onInstalled'),
      sendMessage: async () => {},
      setUninstallURL() {},
      getURL: (path) => path,
    },
    storage: { local: storageArea(window.__local), session: storageArea(window.__session), onChanged: event('storage.onChanged') },
    webRequest: {
      onBeforeRequest: event('webRequest.onBeforeRequest'),
      onBeforeSendHeaders: event('webRequest.onBeforeSendHeaders'),
      onSendHeaders: event('webRequest.onSendHeaders'),
      onHeadersReceived: event('webRequest.onHeadersReceived'),
      onCompleted: event('webRequest.onCompleted'),
      onErrorOccurred: event('webRequest.onErrorOccurred'),
      filterResponseData(requestId) {
        const filter = { write() {}, disconnect() {}, close() {} };
        window.__filters[requestId] = filter;
        return filter;
      },
    },
    downloads: {
      async download(options) {
        if (window.__rejectDownloads) {
          throw new Error('Download canceled by the user');
        }
        const saved = { ...options };
        if (options.url.startsWith('blob:')) {
          const bytes = new Uint8Array(await (await fetch(options.url)).arrayBuffer());
          Object.assign(saved, { url: 'blob', size: bytes.length, firstByte: bytes[0] });
        }
        window.__downloads.push(saved);
        return window.__downloads.length; // download id
      },
      search: async ({ id }) => (id <= window.__downloads.length ? [{ id, state: window.__downloadState ?? 'in_progress' }] : []),
      onChanged: event('downloads.onChanged'),
    },
    action: { onClicked: event('action.onClicked'), setBadgeText() {}, setBadgeBackgroundColor() {} },
    tabs: { get: async () => ({ title: 'Tab title' }), create() {} },
    windows: { create() {} },
    permissions: { contains: async () => true, request: async () => true, onRemoved: event('permissions.onRemoved') },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    extension: { inIncognitoContext: false },
  };

  // Call the listeners of an event, like the browser does
  window.__emit = (name, ...args) => (window.__listeners[name] || []).slice().map((listener) => listener(...args));
})();
