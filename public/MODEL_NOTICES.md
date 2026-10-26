# MediaPipe model and runtime notices

Verified for Niuniu 2.0.0 on 2026-10-26.

## Distributed components

Niuniu self-hosts the following Google MediaPipe artifacts. Model weights and the four runtime files below are distributed without changes. The JavaScript API from `@mediapipe/tasks-vision` is bundled and minified into Niuniu's worker by esbuild; our worker adds local resource loading, restricted network access, input alignment and result conversion.

- Runtime: `@mediapipe/tasks-vision@1.1.1`, exact version in `package.json` and `pnpm-lock.yaml`. [npm package](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.1.1) · [versioned tarball](https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.1.1.tgz)
- Face model: `face_landmarker/float16/1`. [Version 1 download](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)
- Pose model: `pose_landmarker_lite/float16/1`. [Version 1 download](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)

The four runtime files come from the package's `wasm/` directory. The classic worker uses either the SIMD pair or the non-SIMD fallback pair; it does not need the separate `*_module_*` files. Total shipped model/runtime payload: 36,351,832 bytes (34.67 MiB). A browser downloads only the selected runtime pair and the requested model, not every model on initial page load.

| File relative to this notice | Bytes | SHA-256 |
| --- | ---: | --- |
| `models/face_landmarker.task` | 3,758,596 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `models/pose_landmarker_lite.task` | 5,777,746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `vision/vision_wasm_internal.js` | 334,128 | `6522286aa32dd93eff17c3da002b0649516f87abfec7a80b5bfe5c9625caa5f8` |
| `vision/vision_wasm_internal.wasm` | 13,519,922 | `0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd` |
| `vision/vision_wasm_nosimd_internal.js` | 333,931 | `942654dbdcebce08ea039af23d18e58bebf23c8607d74023d2df7071c8a7b638` |
| `vision/vision_wasm_nosimd_internal.wasm` | 12,627,509 | `c9b1b69bb87baf9e529254d8559dcbcf4c5a9c0eda84f56a12f17d675335ec9c` |

These are hashes computed from the files shipped by this project, not an upstream-signed build attestation. Model URLs use fixed version 1 rather than `latest`.

## License and source of the license determination

The runtime package declares `Apache-2.0` in its package metadata. The model license determination is based on the model cards themselves and an explicit statement by a MediaPipe repository collaborator; it is not inferred from the developer documentation's code-sample footer.

- [BlazeFace short-range model card, page 1](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf): Apache License, Version 2.0.
- [Face Mesh V2 model card, page 1](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf): Apache License, Version 2.0.
- [Blendshape V2 model card, page 1](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf): Apache License, Version 2.0. This component is included in the upstream face task bundle even though Niuniu disables blendshape output.
- [BlazePose GHUM 3D model card, page 2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf): Apache License, Version 2.0; the card describes and evaluates the Lite, Full and Heavy variants.
- [MediaPipe maintainer clarification, 2026-10-05](https://github.com/google-ai-edge/mediapipe/issues/6355#issuecomment-5997480830): collaborator `schmidt-sebastian` explicitly confirms that the source and models are Apache 2 licensed unless otherwise noted.
- The [Face Landmarker model guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models) links the three face model cards; the [Pose Landmarker model guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models) links the GHUM card for the Lite bundle.

A copy of the [upstream repository license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE), including its additional UTF-source notice, accompanies this distribution as [LICENSE-MEDIAPIPE.txt](./LICENSE-MEDIAPIPE.txt). Copyright and other rights remain with the upstream authors and contributors.

Apache 2.0 permits use, modification and redistribution subject to its conditions. Redistributors must provide the license, preserve applicable copyright/attribution notices, identify modifications and retain any applicable upstream NOTICE content. This notice records Niuniu's integration changes; the model and WASM binaries are unmodified. The installed npm 1.1.1 package did not contain a standalone LICENSE or NOTICE file, so the upstream repository license is provided explicitly. This project does not claim Google endorsement, trademark rights, an upstream reproducible-build attestation, or new ownership of the models. The full license, including its warranty disclaimer, controls.

## Processing and operational notes

Images and model inference remain in the browser. Niuniu's vision worker allows only same-origin GET/HEAD requests beneath this page's `models/` and `vision/` folders and blocks the SDK's optional external telemetry. The model files are fetched from the same deployment as Niuniu; images, detected coordinates and masks are not uploaded. [Upstream SDK telemetry discussion](https://github.com/google-ai-edge/mediapipe/issues/6306#issuecomment-4673728357) · [upstream privacy notice](https://goo.gle/mediapipe-privacy).

Automatic localization requires opening the editor through HTTP(S), including the local launcher or GitHub Pages. Direct `file://` opening retains manual tools but cannot initialize automatic localization. Models load only when requested. Cancelling terminates active inference; switching between face and pose closes the prior model to limit memory use.

The models provide approximate landmarks and person masks. Niuniu derives eye/nose ellipses and arm direction/width candidates from those outputs. Ear points are labelled auxiliary and do not represent a complete ear contour. Obstruction, crossed limbs, small subjects, profiles and unusual images can require manual correction. The configured maximum is three people; this is a cap, not a guarantee of multi-person accuracy.

For pose inference, Niuniu pads image width to a multiple of four by replicating at most three edge pixels, then maps landmarks and masks back to the original image. This avoids a float-mask row-stride failure reproduced with 711-pixel-wide images. Model weights are not altered by this input processing.
