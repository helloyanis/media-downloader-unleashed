/**
    MyGet - A multi-thread downloading library
    Copyright (C) 2014-2022 [Chandler Stimson]

    This program is free software: you can redistribute it and/or modify
    it under the terms of the Mozilla Public License as published by
    the Mozilla Foundation, either version 2 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    Mozilla Public License for more details.
    You should have received a copy of the Mozilla Public License
    along with this program.  If not, see {https://www.mozilla.org/en-US/MPL/}.

    GitHub: https://github.com/chandler-stimson/live-stream-downloader/
    Homepage: https://webextension.org/listing/hls-downloader.html
*/

/* global events */

  let wakeLock = null;
  const getWakeLock = async () => {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      console.log('Screen wake lock has been acquired');
    } catch (err) {
      // the wake lock request fails - usually system related, such being low on battery
      console.log(`${err.name}, ${err.message}`);
    }
  }
  
  document.getElementById('power').addEventListener('change', async () => {
    if (document.getElementById('power').checked) {
      browser.storage.local.set({
        'wake-lock': true
      });
      getWakeLock();
    } else {
      browser.storage.local.remove('wake-lock');
      wakeLock.release();
    }
  });

  const getDefaultWakeLock = async () => {
    const res = await browser.storage.local.get('wake-lock')
    if (Object.keys(res).length !== 0) {
      document.getElementById('power').checked = true;
      getWakeLock();
    } else {
      document.getElementById('power').checked = false;
    }
  };

  getDefaultWakeLock();

  events.after.add(() => browser.runtime.sendMessage({
    method: 'release-awake-if-possible'
  }, () => browser.runtime.lastError));

  // check after 1 minute
  // in case there is an active downloading job and the warning prevents the window from being closed
  addEventListener('beforeunload', () => browser.alarms.create('release-awake-if-possible', {
    when: Date.now() + 60000
  }));

  browser.runtime.onMessage.addListener((request, sender, response) => {
    if (request.method === 'any-active' && document.body.dataset.mode === 'download') {
      response(true);
    }
  });

