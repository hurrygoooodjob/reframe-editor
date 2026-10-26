# Third Party Notices

The project's MIT license covers original Niuniu code. It does not replace the licenses or public-domain notices applicable to the following assets and dependencies. Keep this file with redistributed source and offline builds.

## Sample photographs

### Hot air balloon

- Local file: `src/assets/balloon.jpg`, 1280 × 850 pixels.
- Work: *Hot air balloon on blue sky* (2016).
- Author: Laura Clugston.
- [Wikimedia Commons source and license record](https://commons.wikimedia.org/wiki/File:Hot_air_balloon_on_blue_sky_(Unsplash).jpg)
- [Original source](https://unsplash.com/photos/pwW2iV9TZao)
- License: [CC0 1.0 Universal Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/).
- Commons records this photograph as published under CC0 before Unsplash changed its sitewide license on 5 June 2017. This notice relies on that recorded CC0 grant, not the current Unsplash license.
- Modification: downloaded the 1280px Wikimedia thumbnail; no crop or retouch.

### NASA astronaut portrait

- Local file: `src/assets/astronaut.jpg`, 960 × 1215 pixels.
- Work: *Eileen Collins, early NASA portrait*.
- Creator: NASA.
- [Wikimedia Commons source and public-domain record](https://commons.wikimedia.org/wiki/File:Eileen_Collins,_early_NASA_portrait.jpg)
- Status: Public domain in the United States as a NASA work, recorded as PD-USGov-NASA.
- Modification: downloaded the 960px Wikimedia thumbnail; no crop or retouch.
- The photograph is included as an editing example. No endorsement by NASA or the depicted person is implied. NASA logos and insignia are not licensed as Niuniu branding.

Source and license records checked on 2026-10-13. Copies of the photographs are embedded in the offline build so that ordinary use does not request remote media.

## React runtime

The installed versions used for this build are React 19.3.0, React DOM 19.3.0 and scheduler 0.28.0. These packages share the following MIT license. Their upstream repository is [facebook/react](https://github.com/facebook/react). Package versions are fixed by `pnpm-lock.yaml`.

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development tools

Development dependencies are installed separately and are not shipped as a development server inside the offline HTML. The current toolchain includes Vite 7.3.7 (MIT), esbuild 0.25.12 (MIT), TypeScript 5.9.3 (Apache-2.0), and React type declarations from DefinitelyTyped (MIT). Their packages retain their own license files. Rebuilding with updated dependencies requires reviewing the resulting lockfile and notices.

## Local vision runtime and pretrained models

Niuniu includes a pinned MediaPipe Tasks Vision runtime and Google Face Landmarker / Pose Landmarker Lite assets. Model sources, checksums, license records, and bundled notices are maintained in [public/MODEL_NOTICES.md](./public/MODEL_NOTICES.md). In the deployed app, the same notice is available as [MODEL_NOTICES.md](./MODEL_NOTICES.md). Retain the model/runtime license files when redistributing. Images are processed locally; the vision worker restricts networking to same-origin model/runtime GET requests.
