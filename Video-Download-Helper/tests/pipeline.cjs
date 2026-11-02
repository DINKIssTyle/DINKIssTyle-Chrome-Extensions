// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
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
const context = vm.createContext({ fetch: async () => ({ ok: false }), chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, Map, Set, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
networkListener({ tabId: 1, url: 'https://cdn.test/movie', initiator: 'https://page.test', responseHeaders: [
  { name: 'Content-Type', value: 'video/mp4' }, { name: 'Content-Range', value: 'bytes 0-999/123456' }, { name: 'Content-Length', value: '1000' }] });
assert.equal(vm.runInContext('detectedMedia[1][0].size', context), 123456);
networkListener({ tabId: 1, url: 'https://cdn.test/playlist', responseHeaders: [{ name: 'Content-Type', value: 'application/vnd.apple.mpegurl' }] });
assert.equal(vm.runInContext('detectedMedia[1][1].type', context), 'm3u8');
runtimeListener({ action: 'discoveredMedia', data: { url: 'https://cdn.test/unplayed.mp4', type: 'video', title: 'Unplayed' } }, { tab: { id: 2 }, url: 'https://page.test' }, () => {});
assert.equal(vm.runInContext('detectedMedia[2].length', context), 1);
assert.equal(vm.runInContext('mp4Filename("A/B.m3u8?token=1")', context), 'A_B.mp4');
assert.equal(vm.runInContext('mp4Filename("v0_0001.dat")', context), 'v0.mp4');

// Verify split MP2T .dat segments (v1_0000.dat, v0_0001.dat .. v0_0004.dat) group into a single item
const splitChunks = [
  ['https://cdn.test/stream/v1_0000.dat', 3200000],
  ['https://cdn.test/stream/v0_0001.dat', 4300000],
  ['https://cdn.test/stream/v0_0002.dat', 4400000],
  ['https://cdn.test/stream/v0_0003.dat', 4100000],
  ['https://cdn.test/stream/v0_0004.dat', 4100000]
];
for (const [url, len] of splitChunks) {
  networkListener({
    tabId: 3,
    url,
    initiator: 'https://page.test',
    responseHeaders: [
      { name: 'Content-Type', value: 'video/mp2t' },
      { name: 'Content-Length', value: String(len) }
    ]
  });
}
assert.equal(vm.runInContext('detectedMedia[3].length', context), 1);
assert.equal(vm.runInContext('detectedMedia[3][0].type', context), 'segments');
assert.equal(vm.runInContext('detectedMedia[3][0].extension', context), 'mp2t');
assert.equal(vm.runInContext('detectedMedia[3][0].segmentCount', context), 5);
assert.equal(vm.runInContext('detectedMedia[3][0].size', context), 20100000);

const offscreen = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, Map, Set, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8').replace(/import\s+[^;]+;\s*/g, ''), offscreen);
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

  // Test full segment sequence probing (0000..0009) from grouped segments (0000..0004)
  offscreen.groupData = JSON.parse(vm.runInContext('JSON.stringify(detectedMedia[3][0].segmentGroup)', context));
  offscreen.setupDNRRules = async () => {};
  offscreen.fetch = async (url) => {
    const m = url.match(/v0_(\d{4})\.dat$/);
    const idx = m ? parseInt(m[1], 10) : -1;
    if (idx >= 0 && idx <= 9) {
      return {
        ok: true,
        status: 206,
        headers: { get: () => 'video/mp2t' },
        body: { getReader: () => ({ read: async () => ({ value: new Uint8Array([0x47, 0x40, 0x00, 0x10]) }), cancel: async () => {} }) }
      };
    }
    return { ok: false, status: 404, headers: { get: () => 'text/html' } };
  };
  vm.runInContext('currentDownload = { segments: [], playlists: new Map(), assetNames: new Map(), abortController: new AbortController(), isCancelled: false }; log = () => {}', offscreen);
  await vm.runInContext('prepareSegmentGroupDownload(groupData)', offscreen);
  assert.equal(vm.runInContext('currentDownload.segments.length', offscreen), 10);
  assert.equal(vm.runInContext('currentDownload.segments[0].url', offscreen), 'https://cdn.test/stream/v0_0000.dat');
  assert.equal(vm.runInContext('currentDownload.segments[0].fallbackUrl', offscreen), 'https://cdn.test/stream/v1_0000.dat');
  assert.equal(vm.runInContext('currentDownload.segments[9].url', offscreen), 'https://cdn.test/stream/v0_0009.dat');

  // Test MPEG-TS fake header stripping in normalizeSegmentBuffer
  const fakeHeaderTs = new Uint8Array(12 + 188 * 3);
  fakeHeaderTs.set([0x89, 0x50, 0x4e, 0x47], 0);
  fakeHeaderTs[12] = 0x47;
  fakeHeaderTs[12 + 188] = 0x47;
  fakeHeaderTs[12 + 376] = 0x47;
  offscreen.testBuf = fakeHeaderTs.buffer;
  const strippedLen = vm.runInContext('normalizeSegmentBuffer(testBuf).byteLength', offscreen);
  assert.equal(strippedLen, 188 * 3);

  // Unit tests for remuxing progress helpers
  const parsedLog = vm.runInContext('parseFfmpegLog("frame= 1234 fps= 45.2 q=-1.0 size= 45056kB time=00:03:15.52 bitrate=1894.2kbits/s speed= 32.4x")', offscreen);
  assert.equal(parsedLog.timeStr, "00:03:15.52");
  assert.equal(parsedLog.timeSec, 195.52);
  assert.equal(parsedLog.speed, "32.4x");
  assert.equal(parsedLog.size, "44.0 MB");
  assert.equal(parsedLog.fps, "45.2");

  assert.equal(vm.runInContext('formatTime(65)', offscreen), "01:05");
  assert.equal(vm.runInContext('formatTime(3665)', offscreen), "01:01:05");

  vm.runInContext(`
    currentDownload = {
      status: "compiling",
      percent: 0,
      totalDuration: 200,
      segments: []
    };
    sendStatusUpdate = () => {};
    updateCompileProgress({ phase: "remux", timeSec: 50, speed: "25x" });
  `, offscreen);
  assert.equal(vm.runInContext('currentDownload.percent', offscreen), 25);
  assert.equal(vm.runInContext('currentDownload.eta', offscreen), "6s");
  assert.match(vm.runInContext('currentDownload.statusText', offscreen), /Remuxing: 00:50 \/ 03:20 \(25%\)/);

  console.log('PASS: range responses, MIME-only HLS, DOM discovery, filenames, AES metadata, ranges, separate audio, unsupported streams, split MP2T .dat grouping & probing, remux progress tracking');
})().catch(error => { console.error(error); process.exitCode = 1; });
