# live-stream-downloader

<a href="https://addons.mozilla.org/addon/media-downloader-unleashed/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="drawing" width="200"/></a>

![image](https://github.com/user-attachments/assets/e35041d2-b320-4019-8178-ff153243a322)

### How to install on Chrome, Edge, Chromium, etc...
1. Get the `addon.xpi` file from the [releases page](https://github.com/helloyanis/media-downloader-unleashed/releases) (scroll down for a bit to see it)
2. Rename it to `addon.zip`
3. Sideload it in your browser. See your browser documentation for more info.

It's not on these stores because :
- Chrome web store wants to get a $5 payment for opening the account which is fundamentally incompatible for a non-profit open-source app
- Edge does not want to accept the add-on because it has `background.scripts` which is only used in Manifest Version 2 while this add-on uses manifest version 3, but the new `background.serviceWorker` is not supported yet by Firefox. I have included both for extended compatibility but removing `background.scripts` as Edge asks would break Firefox.

#### What this add-on does

You can download audios, videos and streams to view offline, from most websites!

- Support for video, audio, and .m3u8 streams
- Clean interface with material design!
- Easy to use settings!
- Multiple detection and download methods to try to find one that works on the site!
- Media preview in the browser!
- Spoof headers and referrer to play and download videos from sites with protections!
- Completely free and open-source! Nothing to pay at all! (Except for donations, which are optional and does not unlock any features)
![image](https://github.com/user-attachments/assets/78b73edd-9c40-4b62-9c24-203fd1311b8f)
