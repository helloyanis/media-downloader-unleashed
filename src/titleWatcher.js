(function () {

  let sentOg = false;
  let lastSent = null;

  function readTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    const ogContent = og && og.getAttribute('content');
    if (ogContent) return { title: ogContent, isOg: true };
    if (!sentOg && document.title) return { title: document.title, isOg: false };
    return { title: null, isOg: false };
  }

  function report() {
    const { title, isOg } = readTitle();
    if (!title || title === lastSent) {
      return;
    }

    if (sentOg && !isOg) {
      return;
    }
    lastSent = title;
    if (isOg) sentOg = true;
    try {
      browser.runtime.sendMessage({ action: 'pageTitleDetected', title })
        .then(() => console.log('[MDU][titleWatcher] sendMessage OK'))
        .catch(e => console.warn('[MDU][titleWatcher] sendMessage failed:', e));
    } catch (e) {
      console.warn('[MDU][titleWatcher] sendMessage throws async exception:', e);
    }
  }

  report();
  const observer = new MutationObserver(report);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();