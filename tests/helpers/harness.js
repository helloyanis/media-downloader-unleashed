// Serves the add-on files and fake media over HTTP, and opens them in headless Chromium with a fake WebExtension API.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const SRC = path.resolve(__dirname, '../../src');
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

/**
 * Start a server for the add-on files (from src/), an empty page (/blank.html) and fake media (/media/*: 1024 bytes of 7, served as audio/mpeg).
 * @returns {Promise<{server: http.Server, baseUrl: string}>}
 */
async function startServer() {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/blank.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><body></body>');
    }
    if (pathname.startsWith('/media/')) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '1024' });
      return res.end(Buffer.alloc(1024, 7));
    }
    const filePath = path.join(SRC, decodeURIComponent(pathname));
    if (!filePath.startsWith(SRC) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Start the server and the browser for a test file.
 * @returns {Promise<{baseUrl: string, browser: import('playwright').Browser, close: () => Promise<void>}>}
 */
async function setUp() {
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch();
  return {
    baseUrl,
    browser,
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}

/**
 * Open popup.html with the fake API of helpers/popup-mock.js.
 * @param {string} setup JavaScript run before the mock, to configure it (window.__MEDIA__, window.__GRANT__...)
 * @returns {Promise<{page: import('playwright').Page, errors: string[]}>} The page, and the errors thrown in it
 */
async function openPopup(browser, baseUrl, setup = '') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const messages = fs.readFileSync(path.join(SRC, '_locales/en/messages.json'), 'utf8');
  await page.addInitScript(`window.__MESSAGES__ = ${messages};\n${setup}`);
  await page.addInitScript({ path: path.join(__dirname, 'popup-mock.js') });
  await page.goto(`${baseUrl}/popup.html`);
  await page.waitForFunction(() => customElements.get('mdui-fab') && document.getElementById('loading-media-list').style.display === 'none');
  return { page, errors };
}

/**
 * Open an empty page with the fake API of helpers/background-mock.js and load background scripts in it, like the add-on's background page.
 * @param {string[]} scripts The scripts to load from src/, in order
 * @returns {Promise<{page: import('playwright').Page, errors: string[]}>} The page, and the errors thrown in it
 */
async function openBackground(browser, baseUrl, scripts) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript({ path: path.join(__dirname, 'background-mock.js') });
  await page.goto(`${baseUrl}/blank.html`);
  for (const script of scripts) {
    await page.addScriptTag({ url: `${baseUrl}/${script}` });
  }
  return { page, errors };
}

module.exports = { setUp, openPopup, openBackground };
