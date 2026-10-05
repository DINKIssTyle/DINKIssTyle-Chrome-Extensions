# Video Download Helper

Reload this extension on `chrome://extensions`, then reload the webpage after updating.
Videos are saved as real MP4 files using the bundled local FFmpeg engine (~31 MB).
Audio-only links retain their source format.

## Detection

- Network response MIME types and full sizes from partial/range responses.
- Video/audio tags, current sources, lazy attributes, links, social metadata,
  JSON and player configuration URLs, cached resource timing entries.
- Dynamic pages, frames and open shadow roots; the ↻ button rescans all frames.
- Deduplicates exact URLs without removing signed query parameters.

## MP4 downloads

Selects the highest-bandwidth HLS rendition and its default separate audio track.
Preserves AES-128 key rotation, media sequence IVs, initialization maps,
byte ranges and discontinuities in a local HLS playlist. FFmpeg remuxes first;
if that fails, it converts to H.264/AAC. Direct video files use the same pipeline.
The offscreen document retains the output until Chrome confirms the save completed.
Failed segments stop the download instead of producing an incomplete file.

Live playlists, DASH manifests and DRM streams are not supported. Blob player
sources are discovered through the underlying network resources when available.
Large files and codec conversion require substantial memory and time.

## Verification

Run `node Video-Download-Helper/tests/pipeline.cjs` from the repository root.
The bundled WASM engine was also verified with a generated HLS sample: output MP4
contained H.264 video and AAC audio. Chrome UI and site-specific behavior still
require a browser smoke test.

## Dependencies

See [third-party notices](vendor/ffmpeg/NOTICE.md) for bundled versions and licenses.
