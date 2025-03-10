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

// prevent closing
{
  const stop = e => {
    e.preventDefault();
    e.returnValue = 'Downloading...';
  };
  events.before.add(() => {
    addEventListener('beforeunload', stop);
  });
  events.after.add(() => {
    removeEventListener('beforeunload', stop);
  });
}
// auto close on success
const done = (success, done) => {
  window.onbeforeunload = null;

  if (document.getElementById('autoclose').checked) {
    if (success) {
      if (done) {
        const timeout = 5 * 1000;
        self.notify('Closing after 5 seconds...', timeout);
        setTimeout(() => window.close(), timeout);
      }
    }
    else {
      // do not auto close when there is a failed download
      events.after.delete(done);
      console.info('Auto-closing is canceled for this session');
    }
  }
};
events.after.add(done);

browser.storage.local.get({
  'autoclose': false
}, prefs => document.getElementById('autoclose').checked = prefs.autoclose);

document.getElementById('autoclose').onchange = e => browser.storage.local.set({
  'autoclose': e.target.checked
});
