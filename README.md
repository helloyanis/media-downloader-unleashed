<a href="https://addons.mozilla.org/addon/media-downloader-unleashed/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="drawing" width="200"/></a>

### How to install on Chrome, Edge, Chromium, etc...
1. Get the `addon.xpi` file from the [releases page](https://github.com/helloyanis/media-downloader-unleashed/releases) (scroll down for a bit to see it)
2. Rename it to `addon.zip`
3. Sideload it in your browser. See your browser documentation for more info.

It's not on these stores because :
- Chrome web store wants to get a $5 payment for opening the account which is fundamentally incompatible for a non-profit open-source app
- Edge does not want to accept the add-on because it has `background.scripts` which is only used in Manifest Version 2 while this add-on uses manifest version 3, but the new `background.serviceWorker` is not supported yet by Firefox. I have included both for extended compatibility but removing `background.scripts` as Edge asks would break Firefox.

## Supporded media types

- 🎬 Video : `3g2`, `3gp`, `asx`, `avi`, `divx`, `4v`, `flv`, `ismv`, `m2t`, `m2ts`, `m2v`, `m4s`, `m4v`, `mk3d`, `mkv`, `mng`, `mov`, `mp2v`, `mp4`, `mp4v`, `mpe`, `mpeg`, `mpeg1`, `mpeg2`, `mpeg4`, `mpg`, `mxf`, `ogm`, `ogv`, `qt`, `rm`, `swf`, `ts`, `vob`, `vp9`, `webm`, `wmv`
- 🎵 Audio : `3ga`, `aac`, `ac3`, `adts`, `aif`, `aiff`, `alac`, `ape`, `asf`, `au`, `dts`, `f4a`, `f4b`, `flac`, `isma`, `it`, `m4a`, `m4b`, `m4r`, `mid`, `mka`, `mod`, `mp1`, `mp2`, `mp3`, `mp4a`, `mpa`, `mpga`, `oga`, `ogg`, `ogx`, `opus`, `ra`, `shn`, `spx`, `vorbis`, `wav`, `weba`, `wma`, `xm`
- 📺 Stream : `f4f`\*, `f4m`\*, `m3u8`, `mpd`\*, `smil`\*

> Note: `*` means partial support. Can download the stream manifest, but not convert to offline video/audio. You can use a third-party tool like ffmpeg to convert the downloaded stream manifest to offline video/audio, or use VLC to play the stream manifest.

- Can change settings to show all requests without filtering if your media is not detected by default.

> Note: Some sites may not work with the add-on due to DRM or other restrictions. If you encounter any issues, please report them on the [GitHub page](https://github.com/helloyanis/media-downloader-unleashed/issues)

#### What this add-on does

You can download audios, videos and streams to view offline, from most websites!

- Support for video, audio, and .m3u8 streams
- Clean interface with material design!
- Easy to use settings!
- Multiple detection and download methods to try to find one that works on the site!
- Media preview in the browser!
- Spoof headers and referrer to play and download videos from sites with protections!
- Completely free and open-source! Nothing to pay at all! (Except for donations, which are optional and does not unlock any features)

![image](https://github.com/user-attachments/assets/8fd28749-a1fa-4ca2-bcdd-c32acad89cfc)![image](https://github.com/user-attachments/assets/8e2619ca-d064-4705-9999-bf862f5379c8)

<a href="https://www.star-history.com/#helloyanis/media-downloader-unleashed&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=helloyanis/media-downloader-unleashed&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=helloyanis/media-downloader-unleashed&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=helloyanis/media-downloader-unleashed&type=Date" />
 </picture>
</a>

#### Third party libraries used :

- [MDUI](https://www.mdui.org/en/) - Material Design UI framework (MIT License)
- [HLS.js](https://github.com/video-dev/hls.js/) - HLS.js library (Apache License 2.0)
