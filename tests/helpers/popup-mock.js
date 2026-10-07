// Fake WebExtension API for popup.html, run in the page before its scripts.
// It lists three detected media (or window.__MEDIA__) and fakes the background script: each download takes window.__DOWNLOAD_DELAY__ ms,
// fails for the URLs in window.__FAIL_URLS__, and is logged in window.__log. window.__GRANT__ is the answer to permission requests (default true),
// window.__ANDROID__ the answer of the background to isAndroid (default false), and window.__LOCAL__ overrides the settings.
(() => {
  const messages = window.__MESSAGES__;
  const log = (window.__log = []);
  window.__permissionRequests = [];
  const listeners = [];
  const now = Date.now();
  const mediaRequest = (url, contentType, size, requestId) => [{
    url, requestId, method: 'GET', size: String(size), timeStamp: now,
    requestHeaders: [{ name: 'Referer', value: 'https://example.com/page' }, { name: 'Accept', value: '*/*' }],
    responseHeaders: [{ name: 'Content-Type', value: contentType }, { name: 'Content-Length', value: String(size) }],
  }];
  const media = window.__MEDIA__ ?? {
    'https://cdn.example.com/a.mp4': mediaRequest('https://cdn.example.com/a.mp4', 'video/mp4', 1000000, 'r1'),
    'https://cdn.example.com/b.mp3': mediaRequest('https://cdn.example.com/b.mp3', 'audio/mpeg', 2000000, 'r2'),
    'https://cdn.example.com/c.webm': mediaRequest('https://cdn.example.com/c.webm', 'video/webm', 3000000, 'r3'),
  };
  const local = {
    'mime-detection': '1', 'url-detection': '1', 'hide-segments': '0', 'download-method': 'fetch',
    'stream-download': 'offline', 'rename-downloads-v2': 'tab', 'media-cache': '1', 'media-cache-private': '0',
    'show-youtube-alert': '1', 'install-date': '2099-01-01', 'has-rated': 'true',
    ...window.__LOCAL__,
  };
  const session = {};
  const ongoing = new Map();
  const storageArea = (data) => ({
    get: async (keys) => {
      const names = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      return Object.fromEntries(names.filter((name) => name in data).map((name) => [name, data[name]]));
    },
    set: async (items) => { Object.assign(data, items); },
    remove: async (key) => { delete data[key]; },
  });
  const emit = (message) => listeners.slice().forEach((listener) => listener(message, {}, () => {}));

  window.browser = {
    runtime: {
      onMessage: {
        addListener: (listener) => listeners.push(listener),
        removeListener: (listener) => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
      },
      getURL: (path) => path,
      async sendMessage(message) {
        switch (message.action) {
          case 'getMediaRequests':
            return message.url ? { [message.url]: media[message.url] } : JSON.parse(JSON.stringify(media));
          case 'getOngoingDownloads':
            return [...ongoing.values()];
          case 'isAndroid':
            return window.__ANDROID__ ?? false;
          case 'downloadRawMedia':
          case 'downloadM3U8Offline':
          case 'downloadMPDOffline': {
            const requestId = message.request.requestId;
            log.push({ event: 'start', url: message.url, fileName: message.fileName ?? null, skipSaveDialog: message.skipSaveDialog });
            ongoing.set(requestId, { requestId, url: message.url });
            await new Promise((resolve) => setTimeout(resolve, window.__DOWNLOAD_DELAY__ ?? 300));
            ongoing.delete(requestId);
            if (window.__FAIL_URLS__?.includes(message.url)) {
              log.push({ event: 'fail', url: message.url });
              return { error: 'simulated failure' };
            }
            log.push({ event: 'end', url: message.url });
            emit({ action: 'downloadComplete', requestId });
            return { success: true };
          }
          default:
            return undefined;
        }
      },
    },
    storage: { local: storageArea(local), session: storageArea(session), onChanged: { addListener() {} } },
    i18n: {
      getUILanguage: () => 'en',
      getMessage(key, substitutions) {
        const entry = messages[key];
        if (!entry) return '';
        const values = substitutions == null ? [] : [].concat(substitutions);
        let text = entry.message;
        for (const [name, placeholder] of Object.entries(entry.placeholders || {})) {
          text = text.replace(new RegExp(`\\$${name}\\$`, 'gi'), values[parseInt(placeholder.content.slice(1), 10) - 1] ?? '');
        }
        return text;
      },
    },
    extension: { inIncognitoContext: false },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    permissions: {
      contains: async () => true,
      request: async (permissions) => { window.__permissionRequests.push(permissions); return window.__GRANT__ ?? true; },
      onRemoved: { addListener() {} },
    },
    tabs: { create() {} },
  };
})();
