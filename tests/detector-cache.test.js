// Which responses detector.js stores in the media cache, with a fake WebExtension API (helpers/background-mock.js)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setUp, openBackground } = require('./helpers/harness');

let env;
let page;
let errors;
before(async () => {
  env = await setUp();
  ({ page, errors } = await openBackground(env.browser, env.baseUrl, ['detector.js']));
  await page.evaluate(() => initCacheState());
});
after(async () => {
  assert.deepEqual(errors, []);
  await env.close();
});

/**
 * Simulate a request whose response body goes through the cache listener: onBeforeRequest, onHeadersReceived, then the body (100 bytes) and its end.
 * @returns {Promise<number|null>} The size of the cached body, or null if nothing was cached
 */
function simulateResponse({ url, requestId, statusCode, responseHeaders }) {
  return page.evaluate(async ({ url, requestId, statusCode, responseHeaders }) => {
    window.__session[url] = [{ url, requestId }]; // the detector only caches the requests it listed
    const details = { url, requestId, incognito: false, statusCode, responseHeaders };
    window.__emit('webRequest.onBeforeRequest', details);
    window.__emit('webRequest.onHeadersReceived', details);
    const filter = window.__filters[requestId];
    filter.ondata({ data: new Uint8Array(100).fill(9).buffer });
    await filter.onstop();

    const db = await openCacheDB();
    const item = await new Promise((resolve, reject) => {
      const req = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).get(url);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return item?.data ? item.data.size : null;
  }, { url, requestId, statusCode, responseHeaders });
}

function cachedItem(url) {
  return page.evaluate(async (url) => {
    const db = await openCacheDB();
    const item = await new Promise((resolve) => { const req = db.transaction([STORE_NAME]).objectStore(STORE_NAME).get(url); req.onsuccess = () => resolve(req.result); });
    return { size: item?.data?.size, status: item?.status };
  }, url);
}

describe('media cache', () => {
  it('stores a whole response', async () => {
    const size = await simulateResponse({ url: 'https://cdn.example.com/whole.mp3', requestId: 'w1', statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'audio/mpeg' }] });
    assert.equal(size, 100);
  });

  it('does not store a partial response (206), like a media player loading a file in parts', async () => {
    const size = await simulateResponse({
      url: 'https://cdn.example.com/partial.mp3', requestId: 'p1', statusCode: 206,
      responseHeaders: [{ name: 'Content-Type', value: 'audio/mpeg' }, { name: 'Content-Range', value: 'bytes 0-99/1024' }],
    });
    assert.equal(size, null);
  });

  it('does not let a partial response replace a whole cached response', async () => {
    const url = 'https://cdn.example.com/seek.mp3';
    assert.equal(await simulateResponse({ url, requestId: 's1', statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'audio/mpeg' }] }), 100);
    await simulateResponse({
      url, requestId: 's2', statusCode: 206,
      responseHeaders: [{ name: 'Content-Type', value: 'audio/mpeg' }, { name: 'Content-Range', value: 'bytes 500-599/1024' }],
    });
    await page.waitForTimeout(200); // headersReceivedListener stores the headers asynchronously
    const cached = await cachedItem(url);
    assert.equal(cached.size, 100, 'the whole response is still cached');
    assert.equal(cached.status, 200, 'with the headers of the whole response, which downloader.js checks');
  });

  it('stores a 206 response that holds the whole file, like the answer to the "bytes=0-" request of a media element', async () => {
    const size = await simulateResponse({
      url: 'https://cdn.example.com/whole-206.mp3', requestId: 'w2', statusCode: 206,
      responseHeaders: [{ name: 'Content-Type', value: 'audio/mpeg' }, { name: 'Content-Range', value: 'bytes 0-99/100' }],
    });
    assert.equal(size, 100);
  });

  it('only keeps track of the responses being captured', async () => {
    assert.equal(await page.evaluate(() => capturedResponses.size), 0, 'forgotten once handled');
    await page.evaluate(() => window.__emit('webRequest.onHeadersReceived', { requestId: 'not-captured', statusCode: 206, responseHeaders: [] }));
    assert.equal(await page.evaluate(() => capturedResponses.size), 0, 'a response without a filter is not tracked');
  });
});
