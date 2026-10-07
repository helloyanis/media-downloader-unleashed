// The "Download all" button of the popup (popup.html, popup.js), with a fake background script (helpers/popup-mock.js)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setUp, openPopup } = require('./helpers/harness');

let env;
before(async () => { env = await setUp(); });
after(async () => { await env.close(); });

const fileNames = (events) => events.map((e) => e.url.split('/').pop());
const downloadLog = (page) => page.evaluate(() => window.__log);
const openDialogs = (page) => page.evaluate(() => [...document.querySelectorAll('mdui-dialog[open]')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()));
const clickDialogButton = (page, label) => page.evaluate((label) => {
  const dialog = [...document.querySelectorAll('mdui-dialog[open]')].pop();
  [...dialog.querySelectorAll('mdui-button')].find((button) => button.textContent.trim() === label).click();
}, label);
const snackbars = (page) => page.evaluate(() => [...document.querySelectorAll('mdui-snackbar')].map((s) => s.innerText.trim()));
const waitForEnded = (page, count) => page.waitForFunction((count) => window.__log.filter((e) => e.event === 'end').length === count, count, { timeout: 15000 });

async function confirmDownloadAll(page) {
  await page.click('#download-all');
  await page.waitForSelector('mdui-dialog[open] >> text=Download all media?');
  await clickDialogButton(page, 'Download all');
}

describe('Download all', () => {
  it('shows a translated, visible button', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl);
    assert.equal(await page.locator('#download-all-label').innerText(), 'Download all');
    const box = await page.locator('#download-all').boundingBox();
    assert.ok(box.width > 0, 'MDUI can render extended FABs with a width of 0, see style.css');
    await page.close();
  });

  it('asks for confirmation with the number of media, and downloads nothing on cancel', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl);
    await page.click('#download-all');
    await page.waitForSelector('mdui-dialog[open]');
    const [dialog] = await openDialogs(page);
    assert.match(dialog, /Download all media\?/);
    assert.match(dialog, /3 media will be downloaded one after the other/);
    await clickDialogButton(page, 'Cancel');
    await page.waitForTimeout(300);
    assert.deepEqual(await downloadLog(page), []);
    assert.deepEqual(await page.evaluate(() => window.__permissionRequests), [], 'no permission request when cancelled');
    await page.close();
  });

  it('downloads every media one at a time, in list order, without the Save dialog', async () => {
    const { page, errors } = await openPopup(env.browser, env.baseUrl);
    await confirmDownloadAll(page);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.getElementById('download-all').disabled), true, 'disabled while running');

    await waitForEnded(page, 3);
    const events = await downloadLog(page);
    assert.deepEqual(events.map((e) => e.event), ['start', 'end', 'start', 'end', 'start', 'end']);
    const starts = events.filter((e) => e.event === 'start');
    assert.deepEqual(fileNames(starts), ['a.mp4', 'b.mp3', 'c.webm']);
    assert.ok(starts.every((e) => e.skipSaveDialog === true));
    assert.deepEqual(await page.evaluate(() => window.__permissionRequests), [{ permissions: ['downloads'] }]);

    await page.waitForFunction(() => !document.getElementById('download-all').disabled);
    const icons = await page.$$eval('#media-list .media-item #download-icon-path', (paths) => paths.map((p) => p.getAttribute('d')));
    assert.ok(icons.every((d) => d.startsWith('m424-296')), 'every item shows the completed icon');
    assert.ok((await snackbars(page)).includes('All downloads are finished: 3 of 3 media downloaded.'), 'tells when everything is finished');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('skips the media already downloading, and leaves single downloads with the Save dialog', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl, 'window.__DOWNLOAD_DELAY__ = 1500;');
    await page.locator('#media-list .media-item').nth(1).locator('#download-button').click();
    await page.waitForTimeout(200);
    await page.click('#download-all');
    await page.waitForSelector('mdui-dialog[open] >> text=Download all media?');
    assert.match((await openDialogs(page)).join(), /2 media will be downloaded/);
    await clickDialogButton(page, 'Download all');

    await waitForEnded(page, 3);
    const starts = (await downloadLog(page)).filter((e) => e.event === 'start');
    assert.deepEqual(fileNames(starts), ['b.mp3', 'a.mp4', 'c.webm'], 'b.mp3 is downloaded only once');
    assert.equal(starts[0].skipSaveDialog, false, 'the item\'s own Download button');
    await page.close();
  });

  it('goes on after a failed download, and shows its error', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl, 'window.__FAIL_URLS__ = ["https://cdn.example.com/a.mp4"];');
    await confirmDownloadAll(page);
    await waitForEnded(page, 2);
    const events = (await downloadLog(page)).map((e) => `${e.event}:${e.url.split('/').pop()}`);
    assert.deepEqual(events, ['start:a.mp4', 'fail:a.mp4', 'start:b.mp3', 'end:b.mp3', 'start:c.webm', 'end:c.webm']);
    assert.match((await openDialogs(page)).join(), /simulated failure/);
    await page.waitForFunction(() => !document.getElementById('download-all').disabled);
    assert.ok((await snackbars(page)).includes('All downloads are finished: 2 of 3 media downloaded.'), 'the failed download is not counted');
    await page.close();
  });

  it('still downloads everything when the downloads permission is refused, leaving the Save dialog to the browser', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl, 'window.__GRANT__ = false;');
    await confirmDownloadAll(page);
    await waitForEnded(page, 3);
    const starts = (await downloadLog(page)).filter((e) => e.event === 'start');
    assert.equal(starts.length, 3);
    assert.ok(starts.every((e) => e.skipSaveDialog === false));
    await page.close();
  });

  it('uses the device type of the background: no downloads permission on Android', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl, 'window.__ANDROID__ = true;');
    await confirmDownloadAll(page);
    await waitForEnded(page, 3);
    assert.deepEqual(await page.evaluate(() => window.__permissionRequests), []);
    assert.ok((await downloadLog(page)).filter((e) => e.event === 'start').every((e) => e.skipSaveDialog === false));
    await page.close();
  });

  it('goes on with the refreshed list when the list is refreshed during the downloads', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl, 'window.__DOWNLOAD_DELAY__ = 600;');
    await confirmDownloadAll(page);
    await page.waitForTimeout(300);
    await page.click('#refresh-list');
    await waitForEnded(page, 3);
    const starts = (await downloadLog(page)).filter((e) => e.event === 'start');
    assert.deepEqual(fileNames(starts), ['a.mp4', 'b.mp3', 'c.webm'], 'each media downloaded once');
    await page.waitForFunction(() => !document.getElementById('download-all').disabled);
    const icons = await page.$$eval('#media-list .media-item #download-icon-path', (paths) => paths.map((p) => p.getAttribute('d')));
    assert.ok(icons.slice(1).every((d) => d.startsWith('m424-296')), 'the items of the refreshed list show the downloads after the refresh as completed');
    await page.close();
  });

  it('tells when there is nothing to download', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl, 'window.__MEDIA__ = {};');
    await page.click('#download-all');
    await page.waitForTimeout(400);
    const snackbars = await page.evaluate(() => [...document.querySelectorAll('mdui-snackbar')].map((s) => s.innerText.trim()));
    assert.ok(snackbars.includes('There is no media to download.'), JSON.stringify(snackbars));
    assert.deepEqual(await openDialogs(page), []);
    await page.close();
  });
});

describe('media list', () => {
  it('is shown once when it is refreshed again while loading', async () => {
    const { page } = await openPopup(env.browser, env.baseUrl);
    await page.evaluate(() => { loadMediaList(); loadMediaList(); loadMediaList(); });
    await page.waitForFunction(() => document.getElementById('loading-media-list').style.display === 'none');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#media-list .media-item').count(), 3);
    assert.equal(await page.locator('#end-of-media-list').count(), 1);
    await page.close();
  });

  it('loads with a "%" that is not an escape in the media or page URL', async () => {
    const setup = `window.__MEDIA__ = { 'https://cdn.example.com/abcdefghijklmnopqr%20clip.mp4': [{
      url: 'https://cdn.example.com/abcdefghijklmnopqr%20clip.mp4', requestId: 'p1', method: 'GET', size: '1000', timeStamp: Date.now(),
      requestHeaders: [{ name: 'Referer', value: 'https://shop.example.com/search?q=50%off' }],
      responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' }] }] };`;
    const { page, errors } = await openPopup(env.browser, env.baseUrl, setup);
    assert.equal(await page.locator('#media-list .media-item').count(), 1);
    const text = await page.locator('#media-list .media-item').innerText();
    assert.match(text, /abcdefghijklmnopqr c…\.mp4/, 'the name is decoded, then shortened');
    assert.match(text, /shop\.example\.com/);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('saves with the whole name from the URL when renaming downloads with the URL', async () => {
    const setup = `window.__LOCAL__ = { 'rename-downloads-v2': 'url' };
      window.__MEDIA__ = { 'https://cdn.example.com/my_holiday_video_2024_final.mp4': [{
        url: 'https://cdn.example.com/my_holiday_video_2024_final.mp4', requestId: 'u1', method: 'GET', size: '1000', timeStamp: Date.now(),
        requestHeaders: [], responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' }] }] };`;
    const { page } = await openPopup(env.browser, env.baseUrl, setup);
    assert.match(await page.locator('#media-list .media-item').innerText(), /my_holiday_video_202…\.mp4/, 'shortened in the list');
    await page.locator('#media-list .media-item #download-button').click();
    await waitForEnded(page, 1);
    assert.equal((await downloadLog(page))[0].fileName, 'my_holiday_video_2024_final.mp4');
    await page.close();
  });
});
