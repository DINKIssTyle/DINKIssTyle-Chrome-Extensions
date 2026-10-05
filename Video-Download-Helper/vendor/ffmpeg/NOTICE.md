# Bundled FFmpeg dependencies

Files are vendored for local execution. No remote code is loaded at runtime.

- @ffmpeg/ffmpeg 0.12.15, MIT: https://github.com/ffmpegwasm/ffmpeg.wasm
  License: LICENSE-wrapper. Source: https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz
- @ffmpeg/core 0.12.10, single-thread ESM build, includes GPL components such as x264.
  GPL v2 text: COPYING.GPLv2. Build/source project: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
  Binary source: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
  FFmpeg source: https://github.com/FFmpeg/FFmpeg

The wrapper license does not cover the core's third-party codec licenses.
