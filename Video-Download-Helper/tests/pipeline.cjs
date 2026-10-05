const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let networkListener, runtimeListener;
const event = { addListener() {} };
const chrome = { storage: { session: { get: async () => ({}), set: async () => {} } }, runtime: { id: 'testextension', onMessage: { addListener(fn) { runtimeListener = fn; } }, sendMessage: async () => ({ success: true }) },
  webRequest: { onHeadersReceived: { addListener(fn) { networkListener = fn; } } },
  tabs: { onUpdated: event, onRemoved: event }, downloads: { onChanged: event },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} } };
const context = vm.createContext({ fetch: async () => ({ ok: false }), chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, Map, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
networkListener({ tabId: 1, url: 'https://cdn.test/movie', initiator: 'https://page.test', responseHeaders: [
  { name: 'Content-Type', value: 'video/mp4' }, { name: 'Content-Range', value: 'bytes 0-999/123456' }, { name: 'Content-Length', value: '1000' }] });
assert.equal(vm.runInContext('detectedMedia[1][0].size', context), 123456);
networkListener({ tabId: 1, url: 'https://cdn.test/playlist', responseHeaders: [{ name: 'Content-Type', value: 'application/vnd.apple.mpegurl' }] });
assert.equal(vm.runInContext('detectedMedia[1][1].type', context), 'm3u8');
runtimeListener({ action: 'discoveredMedia', data: { url: 'https://cdn.test/unplayed.mp4', type: 'video', title: 'Unplayed' } }, { tab: { id: 2 }, url: 'https://page.test' }, () => {});
assert.equal(vm.runInContext('detectedMedia[2].length', context), 1);
assert.equal(vm.runInContext('mp4Filename("A/B.m3u8?token=1")', context), 'A_B.mp4');
const offscreen = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, Map, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8').replace(/^import .*\n/, ''), offscreen);
async function parse(text, url = 'https://cdn.test/path/index.m3u8') {
  vm.runInContext('currentDownload = { segments: [], playlists: new Map(), assetNames: new Map() }; log = () => {}', offscreen);
  offscreen.text = text; offscreen.url = url;
  return vm.runInContext('parsePlaylist(text, url)', offscreen);
}
(async () => {
  await parse('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\n#EXTINF:1,\n../segment.ts\n#EXT-X-ENDLIST');
  assert.equal(vm.runInContext('currentDownload.segments[0].url', offscreen), 'https://cdn.test/key');
  assert.match(vm.runInContext('[...currentDownload.playlists.values()][0]', offscreen), /MEDIA-SEQUENCE:42/);
  await parse('#EXTM3U\n#EXT-X-MAP:URI="full.mp4",BYTERANGE="20@0"\n#EXTINF:1,\n#EXT-X-BYTERANGE:30@20\nfull.mp4\n#EXTINF:1,\n#EXT-X-BYTERANGE:40\nfull.mp4\n#EXT-X-ENDLIST');
  assert.equal(vm.runInContext('currentDownload.segments[2].range.start', offscreen), 50);
  assert.ok(!vm.runInContext('[...currentDownload.playlists.values()][0]', offscreen).includes('BYTERANGE'));
  offscreen.fetchWithHeaders = async url => '#EXTM3U\n#EXTINF:1,\n' + (url.includes('audio') ? 'audio.aac' : 'video.ts') + '\n#EXT-X-ENDLIST';
  const master = await parse('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=500,AUDIO="sound"\nvideo.m3u8');
  assert.match(master, /master/);
  assert.equal(vm.runInContext('currentDownload.segments.length', offscreen), 2);
  await assert.rejects(parse('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST'), /Protected/);
  await assert.rejects(parse('#EXTM3U\n#EXTINF:1,\nsegment.ts'), /Live/);
  console.log('PASS: range responses, MIME-only HLS, DOM discovery, filenames, AES metadata, ranges, separate audio, unsupported streams');
})().catch(error => { console.error(error); process.exitCode = 1; });
