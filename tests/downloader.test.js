// How downloader.js saves the media files, with a fake WebExtension API (helpers/background-mock.js)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setUp, openBackground } = require('./helpers/harness');

let env;
let page;
let errors;
before(async () => {
  env = await setUp();
  // detector.js defines the media cache (openCacheDB, STORE_NAME) that downloader.js reads
  ({ page, errors } = await openBackground(env.browser, env.baseUrl, ['detector.js', 'downloader.js']));
});
after(async () => {
  assert.deepEqual(errors, []);
  await env.close();
});

/**
 * Send a downloadRawMedia message, like the popup does, then report the download as complete.
 * The server sends 1024 bytes of 7 for /media/*.
 */
function downloadRawMedia({ path = '/media/file.mp3', fileName = 'file.mp3', contentType = 'audio/mpeg', downloadMethod = 'fetch', skipSaveDialog = false, skipCache = true, requestId, downloadState, rejectDownloads = false }) {
  return page.evaluate(async ({ url, fileName, contentType, downloadMethod, skipSaveDialog, skipCache, requestId, downloadState, rejectDownloads }) => {
    window.__downloads = [];
    window.__linkDownloads = [];
    window.__revoked = [];
    window.__downloadState = downloadState;
    window.__rejectDownloads = rejectDownloads;
    const message = {
      action: 'downloadRawMedia', url, fileName, headers: [], downloadMethod, skipCache, skipSaveDialog,
      request: { requestId, method: 'GET', requestHeaders: [], responseHeaders: [{ name: 'Content-Type', value: contentType }] },
    };
    const [result] = window.__emit('runtime.onMessage', message, {}).filter((r) => r && typeof r.then === 'function');
    let error = null;
    try {
      await result;
    } catch (e) {
      error = e.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // the native method calls browser.downloads.download without waiting for it
    const revokedBeforeComplete = window.__revoked.length;
    window.__emit('downloads.onChanged', { id: window.__downloads.length, state: { current: 'complete' } });
    return {
      error,
      downloads: window.__downloads,
      linkDownloads: window.__linkDownloads,
      revokedBeforeComplete,
      revokedAfterComplete: window.__revoked.length,
      stillFlagged: noSaveDialogRequests.has(requestId),
    };
  }, { url: `${env.baseUrl}${path}`, fileName, contentType, downloadMethod, skipSaveDialog, skipCache, requestId, downloadState, rejectDownloads });
}

// Put an item in the media cache, with a body of `size` bytes of 9
function putInCache(path, status, headers, size) {
  return page.evaluate(async ({ url, status, headers, size }) => {
    const db = await openCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).put({ url, status, headers, data: new Blob([new Uint8Array(size).fill(9)]), timestamp: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { url: `${env.baseUrl}${path}`, status, headers, size });
}

describe('saving files without the Save dialog ("Download all")', () => {
  it('fetch method: saves with the downloads API and saveAs false, and revokes the blob URL only once the download is complete', async () => {
    const r = await downloadRawMedia({ skipSaveDialog: true, requestId: 'f1' });
    assert.deepEqual(r.linkDownloads, []);
    assert.equal(r.downloads.length, 1);
    assert.equal(r.downloads[0].saveAs, false);
    assert.equal(r.downloads[0].filename, 'file.mp3');
    assert.equal(r.downloads[0].size, 1024);
    assert.equal(r.revokedBeforeComplete, 0);
    assert.equal(r.revokedAfterComplete, 1);
    assert.equal(r.stillFlagged, false, 'the flag is only kept during the download');
  });

  it('revokes the blob URL if the download is refused', async () => {
    const r = await downloadRawMedia({ skipSaveDialog: true, rejectDownloads: true, requestId: 'f3' });
    assert.ok(r.error);
    assert.equal(r.revokedBeforeComplete, 1);
  });

  it('revokes the blob URL of a download already complete when it starts being watched', async () => {
    const r = await downloadRawMedia({ skipSaveDialog: true, downloadState: 'complete', requestId: 'f4' });
    assert.equal(r.revokedBeforeComplete, 1);
    assert.equal(r.revokedAfterComplete, 1, 'revoked once');
  });

  it('native method: passes saveAs false', async () => {
    const r = await downloadRawMedia({ downloadMethod: 'browser', skipSaveDialog: true, requestId: 'b1' });
    assert.equal(r.downloads.length, 1);
    assert.equal(r.downloads[0].saveAs, false);
    assert.ok(r.downloads[0].url.endsWith('/media/file.mp3'));
  });
});

describe('single downloads are unchanged', () => {
  it('fetch method: saves with a link click', async () => {
    const r = await downloadRawMedia({ requestId: 'f2' });
    assert.deepEqual(r.downloads, []);
    assert.deepEqual(r.linkDownloads, ['file.mp3']);
  });

  it('native method: leaves saveAs to the browser', async () => {
    const r = await downloadRawMedia({ downloadMethod: 'browser', requestId: 'b2' });
    assert.equal(r.downloads.length, 1);
    assert.equal('saveAs' in r.downloads[0], false);
  });
});

describe('file extension', () => {
  const title = "C'è un cadavere in biblioteca - MLOL - Sistema Bibliotecario di Milano";

  it('is added from the Content-Type to a name without one, like the tab title', async () => {
    const r = await downloadRawMedia({ path: '/media/stream?id=42', fileName: title, skipSaveDialog: true, requestId: 'n1' });
    assert.equal(r.downloads[0].filename, `${title}.mp3`);
  });

  it('is taken from the URL first', async () => {
    const r = await downloadRawMedia({ path: '/media/track01.m4a', fileName: title, contentType: 'application/octet-stream', skipSaveDialog: true, requestId: 'n2' });
    assert.equal(r.downloads[0].filename, `${title}.m4a`);
  });

  it('is not added twice', async () => {
    const r = await downloadRawMedia({ path: '/media/track01.mp3', fileName: 'track01.mp3', skipSaveDialog: true, requestId: 'n3' });
    assert.equal(r.downloads[0].filename, 'track01.mp3');
  });

  it('is added even if the name ends like a domain', async () => {
    const r = await downloadRawMedia({ path: '/media/stream', fileName: 'Some page - example.com', skipSaveDialog: true, requestId: 'n4' });
    assert.equal(r.downloads[0].filename, 'Some page - example.com.mp3');
  });

  it("is the media type rather than an extension of the URL that isn't a media one", async () => {
    const r = await downloadRawMedia({ path: '/media/getvideo.php?id=1', fileName: 'My Video', contentType: 'video/mp4', skipSaveDialog: true, requestId: 'n6' });
    assert.equal(r.downloads[0].filename, 'My Video.mp4');
  });

  it('is not added to a name that already has a media extension', async () => {
    const r = await downloadRawMedia({ path: '/media/clip.m4v', fileName: 'clip.mp4', contentType: 'video/mp4', skipSaveDialog: true, requestId: 'n7' });
    assert.equal(r.downloads[0].filename, 'clip.mp4');
  });

  it('is added to single downloads too', async () => {
    const r = await downloadRawMedia({ path: '/media/stream', fileName: title, requestId: 'n5' });
    assert.deepEqual(r.linkDownloads, [`${title}.mp3`]);
  });
});

describe('media cache', () => {
  it('ignores a cached partial response (206) and downloads the whole file', async () => {
    await putInCache('/media/partial.mp3', 206, [{ name: 'Content-Range', value: 'bytes 0-99/1024' }, { name: 'Content-Length', value: '100' }], 100);
    const r = await downloadRawMedia({ path: '/media/partial.mp3', skipSaveDialog: true, skipCache: false, requestId: 'c1' });
    assert.equal(r.downloads[0].size, 1024);
    assert.equal(r.downloads[0].firstByte, 7, 'from the network');
  });

  it('ignores a cached body shorter than its Content-Length', async () => {
    await putInCache('/media/truncated.mp3', 200, [{ name: 'Content-Length', value: '1024' }], 100);
    const r = await downloadRawMedia({ path: '/media/truncated.mp3', skipSaveDialog: true, skipCache: false, requestId: 'c2' });
    assert.equal(r.downloads[0].size, 1024);
    assert.equal(r.downloads[0].firstByte, 7, 'from the network');
  });

  it('uses a cached 206 response that holds the whole file, like the answer to the "bytes=0-" request of a media element', async () => {
    await putInCache('/media/whole-206.mp3', 206, [{ name: 'Content-Range', value: 'bytes 0-1023/1024' }, { name: 'Content-Length', value: '1024' }], 1024);
    const r = await downloadRawMedia({ path: '/media/whole-206.mp3', skipSaveDialog: true, skipCache: false, requestId: 'c4' });
    assert.equal(r.downloads[0].firstByte, 9, 'from the cache');
  });

  it('uses a complete cached response', async () => {
    await putInCache('/media/whole.mp3', 200, [{ name: 'Content-Length', value: '1024' }], 1024);
    const r = await downloadRawMedia({ path: '/media/whole.mp3', skipSaveDialog: true, skipCache: false, requestId: 'c3' });
    assert.equal(r.downloads[0].size, 1024);
    assert.equal(r.downloads[0].firstByte, 9, 'from the cache');
  });
});

describe('device type', () => {
  it('answers isAndroid for the popup, with the device type forced in the settings', async () => {
    const answers = await page.evaluate(async () => {
      const ask = () => window.__emit('runtime.onMessage', { action: 'isAndroid' }, {}).find((r) => r && typeof r.then === 'function');
      window.__local['force-device-type'] = 'android';
      const forcedAndroid = await ask();
      window.__local['force-device-type'] = 'desktop';
      return [forcedAndroid, await ask()];
    });
    assert.deepEqual(answers, [true, false]);
  });
});
