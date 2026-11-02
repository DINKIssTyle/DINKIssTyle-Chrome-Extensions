// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
import { FFmpeg } from "./vendor/ffmpeg/index.js";
let converter;
let saveResolve;
let saveReject;
// Headless Offscreen HLS & Segmented Stream Downloader & Compiler

let db = null;
const DB_NAME = "HLSDownloaderDB";
const STORE_NAME = "segments";

let currentDownload = null;
const logHistory = [];

// Log function that pushes to status report
function log(msg, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] ${msg}`;
  logHistory.push(formatted);
  console.log(`[${type.toUpperCase()}] ${msg}`);
  
  sendStatusUpdate({ logs: [formatted] }); // Send delta logs
}

// Initial Listener for messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "offscreenSaveState") {
    if (message.state === "complete") saveResolve?.();
    if (message.state === "interrupted") saveReject?.(new Error(message.error || "Saving interrupted"));
  } else if (message.action === "triggerOffscreenDownload") {
    const downloadData = message.data;
    startDownload(downloadData);
    sendResponse({ success: true });
  } else if (message.action === "offscreenPause") {
    pauseDownload();
    sendResponse({ success: true });
  } else if (message.action === "offscreenResume") {
    resumeDownload();
    sendResponse({ success: true });
  } else if (message.action === "offscreenCancel") {
    cancelDownload();
    sendResponse({ success: true });
  } else if (message.action === "offscreenConfirmSkip") {
    confirmSkipCompile();
    sendResponse({ success: true });
  }
});

// Broadcast progress states to background
function sendStatusUpdate(delta = {}) {
  if (!currentDownload) return;

  const data = {
    percent: currentDownload.percent,
    downloadedCount: currentDownload.downloadedCount,
    totalCount: currentDownload.segments.length,
    speed: currentDownload.speed || "0 KB/s",
    eta: currentDownload.eta || "--:--",
    status: currentDownload.status,
    stage: currentDownload.stage || null,
    statusText: currentDownload.statusText || null,
    timeInfo: currentDownload.timeInfo || null,
    compileSpeed: currentDownload.compileSpeed || null,
    ...delta
  };

  chrome.runtime.sendMessage({
    action: "offscreenProgressUpdate",
    data: data
  }).catch(() => {
    // Ignore runtime error when channel closes
  });
}

// IndexedDB Handlers
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve();
    };
    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

function saveSegmentToDB(segmentKey, data) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Database not initialized");
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ key: segmentKey, buffer: data });
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

function getSegmentFromDB(segmentKey) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Database not initialized");
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(segmentKey);
    request.onsuccess = (e) => {
      resolve(e.target.result ? e.target.result.buffer : null);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

function clearSegmentsFromDB(idPrefix) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const keyRange = IDBKeyRange.bound(idPrefix + "_", idPrefix + "_\uffff");
    const request = store.delete(keyRange);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

// Strip fake header bytes if an MPEG-TS segment (.dat / .bin) has obfuscation padding before 0x47 sync bytes
function normalizeSegmentBuffer(buffer) {
  if (!buffer || buffer.byteLength < 377) return buffer;
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x47) return buffer;
  // Preserve MP4 / fMP4 boxes (ftyp, styp, moof, sidx, emsg, free, mdat, wide)
  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (/^(ftyp|styp|moof|sidx|emsg|free|mdat|wide)$/.test(boxType)) return buffer;
  // Scan first 4KB for MPEG-TS 188-byte sync byte pattern (0x47 at i, i+188, i+376)
  const limit = Math.min(bytes.length - 376, 4096);
  for (let i = 1; i < limit; i++) {
    if (bytes[i] === 0x47 && bytes[i + 188] === 0x47 && bytes[i + 376] === 0x47) {
      return buffer.slice(i);
    }
  }
  return buffer;
}

// Build segment URL from variant template and sequence index
function buildVariantSegmentUrl(variant, index) {
  const idxStr = variant.padWidth > 0
    ? String(index).padStart(variant.padWidth, "0")
    : String(index);
  return `${variant.baseUrl}${variant.prefix}${idxStr}${variant.suffix}${variant.query || ""}`;
}

// Probe if a segment URL exists without downloading the entire segment body
async function probeSegmentUrl(targetUrl) {
  await setupDNRRules(targetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  currentDownload.abortController.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      method: "GET",
      cache: "no-cache",
      credentials: "include",
      headers: { Range: "bytes=0-3" }
    });
    if (!response.ok) return false;
    const ct = (response.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("application/json") || ct.includes("text/plain") || ct.includes("application/xml")) {
      return false;
    }
    if (response.body) {
      const reader = response.body.getReader();
      const { value } = await reader.read();
      await reader.cancel().catch(() => {});
      if (!value || value.byteLength === 0) return false;
      // Reject HTML/XML ('<') or JSON ('{') error responses disguised with binary content-type
      if (value[0] === 0x3c || value[0] === 0x7b) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    currentDownload.abortController.signal.removeEventListener("abort", onAbort);
  }
}

// Prepare full segment list from a grouped segment stream (e.g. v1_0000.dat, v0_0001.dat, v0_0002.dat...)
async function prepareSegmentGroupDownload(group) {
  if (!group) throw new Error("Missing segment group metadata.");
  const variants = Object.values(group.variants || {});
  variants.sort((a, b) => {
    const aMulti = a.count >= 2 ? 1 : 0;
    const bMulti = b.count >= 2 ? 1 : 0;
    if (aMulti !== bMulti) return bMulti - aMulti;
    if ((b.avgSize || 0) !== (a.avgSize || 0)) return (b.avgSize || 0) - (a.avgSize || 0);
    return b.count - a.count;
  });

  const primary = variants[0] || null;
  const observedList = group.observedSegments || [];
  const observedMap = new Map();
  for (const seg of observedList) {
    if (!observedMap.has(seg.index) || (primary && seg.variantKey === primary.variantKey)) {
      observedMap.set(seg.index, seg);
    }
  }
  const observedIndices = [...observedMap.keys()].sort((a, b) => a - b);

  if (!primary) {
    if (observedList.length === 0) throw new Error("No segments found in segmented stream.");
    for (const seg of observedList) {
      const index = currentDownload.segments.length;
      currentDownload.segments.push({
        index,
        seqIndex: seg.index ?? index,
        name: `asset${index}.bin`,
        url: seg.url,
        fallbackUrl: null,
        variantKey: seg.variantKey || "default",
        status: "pending",
        retryCount: 0
      });
    }
    currentDownload.inputName = "playlist0.m3u8";
    return "playlist0.m3u8";
  }

  log(`Selected stream template: ${primary.prefix}${"0".repeat(primary.padWidth || 1)}${primary.suffix}`, "info");

  // 1. Determine startIndex (prefer 0 or 1 so the video starts from the very beginning)
  let startIndex = observedIndices.length > 0 ? observedIndices[0] : 0;
  if (startIndex > 0) {
    if (await probeSegmentUrl(buildVariantSegmentUrl(primary, 0))) {
      startIndex = 0;
    } else if (startIndex > 1 && await probeSegmentUrl(buildVariantSegmentUrl(primary, 1))) {
      startIndex = 1;
    }
  }

  // 2. Determine endIndex using exponential + binary search beyond maxObserved
  const maxObserved = observedIndices.length > 0 ? observedIndices[observedIndices.length - 1] : startIndex;
  let endIndex = maxObserved;

  if (await probeSegmentUrl(buildVariantSegmentUrl(primary, maxObserved + 1))) {
    log("Probing stream to find total segment count...", "info");
    let low = maxObserved + 1;
    let high = null;
    let step = 4;
    while (step <= 16384) {
      if (currentDownload.isCancelled) throw new Error("Cancelled");
      const candidate = low + step;
      if (await probeSegmentUrl(buildVariantSegmentUrl(primary, candidate))) {
        low = candidate;
        step *= 2;
      } else {
        high = candidate;
        break;
      }
    }
    if (high === null) high = low + 1;
    while (low + 1 < high) {
      if (currentDownload.isCancelled) throw new Error("Cancelled");
      const mid = Math.floor((low + high) / 2);
      if (await probeSegmentUrl(buildVariantSegmentUrl(primary, mid))) {
        low = mid;
      } else {
        high = mid;
      }
    }
    endIndex = low;
  }

  log(`Resolved segment sequence: #${startIndex} to #${endIndex} (${endIndex - startIndex + 1} segments)`, "info");

  for (let seq = startIndex; seq <= endIndex; seq++) {
    const obs = observedMap.get(seq);
    const primaryUrl = buildVariantSegmentUrl(primary, seq);
    const isSameVariant = obs && obs.variantKey === primary.variantKey;
    const url = isSameVariant ? obs.url : primaryUrl;
    const fallbackUrl = isSameVariant
      ? (obs.url !== primaryUrl ? primaryUrl : null)
      : (obs ? obs.url : null);
    const index = currentDownload.segments.length;
    currentDownload.segments.push({
      index,
      seqIndex: seq,
      name: `asset${index}.bin`,
      url,
      fallbackUrl,
      variantKey: isSameVariant ? obs.variantKey : primary.variantKey,
      fallbackVariantKey: isSameVariant ? primary.variantKey : (obs ? obs.variantKey : null),
      status: "pending",
      retryCount: 0
    });
  }

  currentDownload.inputName = "playlist0.m3u8";
  return "playlist0.m3u8";
}

// Pipeline Main
async function startDownload(data) {
  try {
    await initDB();
    await clearSegmentsFromDB(data.id);

    currentDownload = {
      id: data.id,
      url: data.url,
      type: data.type,
      manifestText: data.manifestText || null,
      manifestBaseUrl: data.manifestBaseUrl || null,
      segmentGroup: data.segmentGroup || null,
      playlists: new Map(),
      assetNames: new Map(),
      filename: data.filename,
      headerHosts: new Map(),
      abortController: new AbortController(),
      concurrency: 5, // Default concurrency
      referer: data.referer,
      origin: data.origin,
      segments: [],
      status: "initializing",
      activeThreads: 0,
      downloadedCount: 0,
      percent: 0,
      totalDuration: data.duration || 0,
      isPaused: false,
      isCancelled: false,
      bytesDownloaded: 0,
      ruleId: 9999 + Math.floor(Math.random() * 10000),
      decryptionKey: null,
      iv: null,
      aesMethod: null
    };

    log(`Spawning HLS Download worker for target: ${currentDownload.filename}`, "info");

    // 1. Setup Session rules
    if (!currentDownload.url.startsWith("blob:")) {
      await setupDNRRules();
    }

    // 2. Fetch and Parse
    if (data.type === "segments") {
      log("Analyzing segmented media stream...", "info");
      currentDownload.inputName = await prepareSegmentGroupDownload(currentDownload.segmentGroup);
    } else if (data.type !== "m3u8") {
      log("Fetching direct media stream...", "info");
      currentDownload.inputName = "input.media";
      currentDownload.segments.push({ index: 0, name: "input.media", url: data.url, status: "pending", retryCount: 0 });
    } else {
      log("Fetching index playlist...", "info");
      let playlistText = null;
      if (currentDownload.url.startsWith("blob:") && currentDownload.manifestText) {
        playlistText = currentDownload.manifestText;
      } else {
        try {
          playlistText = await fetchWithHeaders(currentDownload.url);
        } catch (fetchErr) {
          if (currentDownload.manifestText) {
            log("Using captured in-page playlist manifest...", "info");
            playlistText = currentDownload.manifestText;
          } else if (currentDownload.segmentGroup) {
            log(`Playlist fetch failed (${fetchErr.message}); falling back to grouped segment stream...`, "warning");
            currentDownload.type = "segments";
            currentDownload.inputName = await prepareSegmentGroupDownload(currentDownload.segmentGroup);
          } else {
            throw fetchErr;
          }
        }
      }
      if (playlistText !== null) {
        log("Parsing playlist manifest...", "info");
        const baseForParse = currentDownload.url.startsWith("blob:")
          ? (currentDownload.manifestBaseUrl || currentDownload.referer || currentDownload.origin)
          : currentDownload.url;
        currentDownload.inputName = await parsePlaylist(playlistText, baseForParse);
      }
    }

    if (currentDownload.segments.length === 0) {
      throw new Error("No media segments found in the playlist.");
    }

    log(`Total segments detected: ${currentDownload.segments.length}`, "success");
    sendStatusUpdate({ totalCount: currentDownload.segments.length });

    // 3. Start Tracker
    startSpeedTracker();

    // 4. Start concurrent queue
    currentDownload.status = "downloading";
    fillQueue();

  } catch (err) {
    log(`Download pipeline crashed: ${err.message}`, "error");
    cleanUpDownload("failed");
  }
}

// Setup DNR rules via Background service worker
async function setupDNRRules(targetUrl = currentDownload.url) {
  if (!currentDownload.referer && !currentDownload.origin) return;

  let urlObj;
  try { urlObj = new URL(targetUrl); } catch { return; }
  if (!["http:", "https:"].includes(urlObj.protocol)) return;
  if (currentDownload.headerHosts.has(urlObj.origin)) return currentDownload.headerHosts.get(urlObj.origin);
  const ruleId = currentDownload.ruleId + currentDownload.headerHosts.size;
  const filter = `${urlObj.protocol}//${urlObj.hostname}/*`;
  const headers = {};
  if (currentDownload.referer) headers["Referer"] = currentDownload.referer;
  if (currentDownload.origin) { try { headers["Origin"] = new URL(currentDownload.origin).origin; } catch {} }

  log(`Registering custom headers (Referer/Origin) for: ${urlObj.hostname}`, "system");

  const registration = new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: "setDNRRules",
      data: {
        ruleId,
        urlFilter: filter,
        headers: headers
      }
    }, (res) => {
      if (res?.success) resolve();
      else reject(new Error(res?.error || "Could not set download headers"));
    });
  });
  currentDownload.headerHosts.set(urlObj.origin, registration);
  return registration;
}

// Clear DNR rules from Background
async function removeDNRRules() {
  if (!currentDownload || !currentDownload.ruleId) return;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: "clearDNRRules",
      data: { ruleIds: Array.from(currentDownload.headerHosts.keys(), (_, index) => currentDownload.ruleId + index) }
    }, () => resolve());
  });
}

// Fetch Helper
async function fetchWithHeaders(targetUrl, responseType = "text", range = null) {
  await setupDNRRules(targetUrl);
  const options = { signal: currentDownload.abortController.signal, method: "GET", cache: "no-cache", credentials: "include", headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {} };
  const response = await fetch(targetUrl, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  
  if (responseType === "arraybuffer") {
    const buffer = await response.arrayBuffer();
    if (range && response.status === 200) return buffer.slice(range.start, range.end + 1);
    return buffer;
  }
  return await response.text();
}

// Parse Playlist
function attributes(line) {
  const result = {};
  for (const match of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) result[match[1]] = match[2].replace(/^"|"$/g, "");
  return result;
}
function asset(url, range) {
  const key = url + JSON.stringify(range || null);
  if (currentDownload.assetNames.has(key)) return currentDownload.assetNames.get(key);
  const index = currentDownload.segments.length;
  const name = `asset${index}.bin`;
  currentDownload.assetNames.set(key, name);
  currentDownload.segments.push({ index, name, url, range, status: "pending", retryCount: 0 });
  return name;
}
async function parsePlaylist(text, parentUrl, depth = 0, isAudio = false) {
  if (depth > 5) throw new Error("Too many nested playlists");
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("Invalid HLS playlist");
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = attributes(lines[i]);
      const uri = lines.slice(i + 1).find(line => line && !line.startsWith('#'));
      if (uri) variants.push({ attrs, url: new URL(uri, parentUrl).href });
    }
  }
  if (variants.length) {
    variants.sort((a, b) => Number(b.attrs.BANDWIDTH || 0) - Number(a.attrs.BANDWIDTH || 0));
    const selected = variants[0];
    const video = await parsePlaylist(await fetchWithHeaders(selected.url), selected.url, depth + 1, false);
    const audioAttrs = lines.filter(line => line.startsWith('#EXT-X-MEDIA:')).map(attributes)
      .filter(a => a.TYPE === 'AUDIO' && a['GROUP-ID'] === selected.attrs.AUDIO && a.URI)
      .sort((a, b) => Number(b.DEFAULT === 'YES') - Number(a.DEFAULT === 'YES'))[0];
    if (!audioAttrs) return video;
    const audioUrl = new URL(audioAttrs.URI, parentUrl).href;
    const audio = await parsePlaylist(await fetchWithHeaders(audioUrl), audioUrl, depth + 1, true);
    const name = `master${depth}.m3u8`;
    currentDownload.playlists.set(name, `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audio}"\n#EXT-X-STREAM-INF:BANDWIDTH=${selected.attrs.BANDWIDTH || 1000000},AUDIO="audio"\n${video}\n`);
    return name;
  }
  if (!lines.includes('#EXT-X-ENDLIST')) throw new Error("Live streams are not yet supported. Select a completed video.");
  const name = `playlist${currentDownload.playlists.size}.m3u8`;
  // Reserve the name before descending into other playlists.
  currentDownload.playlists.set(name, '');
  const rewritten = [];
  let range = null;
  const ends = new Map();
  function byteRange(value, url) {
    const [length, offset] = value.split('@').map(Number);
    const start = offset ?? ends.get(url);
    if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(start)) throw new Error('Invalid HLS byte range');
    ends.set(url, start + length);
    return { start, end: start + length - 1 };
  }
  let currentExtinf = 0;
  for (let line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:\s*([0-9.]+)/);
      if (match) currentExtinf = parseFloat(match[1]);
      rewritten.push(line);
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) { range = line.split(':')[1]; continue; }
    if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(line);
      if (line.startsWith('#EXT-X-KEY:') && attrs.METHOD !== 'NONE' &&
        (attrs.METHOD !== 'AES-128' || (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity'))) throw new Error('Protected or unsupported encrypted stream');
      if (attrs.URI) {
        const url = new URL(attrs.URI, parentUrl).href;
        const local = asset(url, attrs.BYTERANGE ? byteRange(attrs.BYTERANGE, url) : null);
        line = line.replace(/URI="[^"]*"/, `URI="${local}"`).replace(/,BYTERANGE="[^"]*"/, '');
      }
    } else if (!line.startsWith('#')) {
      const url = new URL(line, parentUrl).href;
      line = asset(url, range ? byteRange(range, url) : null);
      range = null;
      if (!isAudio && currentExtinf > 0) {
        currentDownload.totalDuration = (currentDownload.totalDuration || 0) + currentExtinf;
        currentExtinf = 0;
      }
    }
    rewritten.push(line);
  }
  currentDownload.playlists.set(name, rewritten.join('\n') + '\n');
  return name;
}

// Queue
function fillQueue() {
  if (!currentDownload || currentDownload.isPaused || currentDownload.isCancelled) return;

  const active = currentDownload.activeThreads;
  const max = currentDownload.concurrency;

  if (active >= max) return;

  const nextSegment = currentDownload.segments.find(s => s.status === "pending");

  if (!nextSegment) {
    if (currentDownload.activeThreads === 0 && currentDownload.status === "downloading") {
      const failedCount = currentDownload.segments.filter(s => s.status === "failed").length;
      if (failedCount > 0) {
        log(`${failedCount} assets failed. MP4 requires a complete stream. Retry the download.`, "error");
        cleanUpDownload("failed");
      } else {
        currentDownload.status = "compiling";
        compileSegments();
      }
    }
    return;
  }

  nextSegment.status = "downloading";
  currentDownload.activeThreads++;
  
  downloadSegment(nextSegment).then(() => {
    if (!currentDownload || currentDownload.isCancelled) return;
    currentDownload.activeThreads--;
    fillQueue();
  });

  if (currentDownload.activeThreads < currentDownload.concurrency) {
    fillQueue();
  }
}

async function downloadSegment(segment) {
  const segmentKey = `${currentDownload.id}_${segment.index}`;
  try {
    let rawBuffer;
    try {
      rawBuffer = await fetchWithHeaders(segment.url, "arraybuffer", segment.range);
      segment.usedVariantKey = segment.variantKey;
    } catch (primaryErr) {
      if (segment.fallbackUrl) {
        log(`Switching segment #${segment.index} to fallback stream URL...`, "info");
        rawBuffer = await fetchWithHeaders(segment.fallbackUrl, "arraybuffer", segment.range);
        segment.usedVariantKey = segment.fallbackVariantKey || segment.variantKey;
      } else {
        throw primaryErr;
      }
    }

    const processedBuffer = currentDownload.type !== "video"
      ? normalizeSegmentBuffer(rawBuffer)
      : rawBuffer;

    if (!currentDownload || currentDownload.isCancelled) return;

    await saveSegmentToDB(segmentKey, processedBuffer);

    segment.status = "completed";
    currentDownload.downloadedCount++;
    currentDownload.bytesDownloaded += processedBuffer.byteLength;
    currentDownload.percent = Math.floor((currentDownload.downloadedCount / currentDownload.segments.length) * 100);

    sendStatusUpdate();

  } catch (err) {
    if (!currentDownload || currentDownload.isCancelled) return;
    log(`Failed segment #${segment.index} (Attempt ${segment.retryCount + 1}): ${err.message}`, "warning");
    if (segment.retryCount < 3) {
      segment.status = "pending";
      segment.retryCount++;
    } else {
      segment.status = "failed";
      log(`Segment #${segment.index} permanently failed after 4 attempts: ${err.message}`, "error");
    }
  }
}

// Speed Tracker
function startSpeedTracker() {
  let lastBytes = 0;
  currentDownload.speedTimer = setInterval(() => {
    if (!currentDownload || currentDownload.isPaused || currentDownload.isCancelled) return;

    const currentBytes = currentDownload.bytesDownloaded;
    const diff = currentBytes - lastBytes;
    lastBytes = currentBytes;

    let speedStr = "0 KB/s";
    if (diff > 0) {
      if (diff > 1024 * 1024) {
        speedStr = `${(diff / (1024 * 1024)).toFixed(2)} MB/s`;
      } else {
        speedStr = `${(diff / 1024).toFixed(1)} KB/s`;
      }
    }
    currentDownload.speed = speedStr;

    const remaining = currentDownload.segments.length - currentDownload.downloadedCount;
    if (currentDownload.downloadedCount > 0 && diff > 0) {
      const avgBytes = currentBytes / currentDownload.downloadedCount;
      const etaSeconds = Math.round((remaining * avgBytes) / diff);
      
      if (etaSeconds < 60) {
        currentDownload.eta = `${etaSeconds}s`;
      } else {
        currentDownload.eta = `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`;
      }
    } else {
      currentDownload.eta = "--:--";
    }

    sendStatusUpdate();
  }, 1000);
}

// Helpers for Compile & Remux Progress Tracking
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseFfmpegLog(msg) {
  const result = {};
  if (!msg || typeof msg !== "string") return result;

  // time=00:01:23.45 or time=01:23.45
  const timeMatch = msg.match(/time=\s*(\d{2}:\d{2}:\d{2}\.\d+|\d{2}:\d{2}\.\d+)/);
  if (timeMatch) {
    result.timeStr = timeMatch[1];
    const parts = timeMatch[1].split(':');
    if (parts.length === 3) {
      result.timeSec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      result.timeSec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    }
  }

  // speed= 35.2x
  const speedMatch = msg.match(/speed=\s*([\d.]+x)/);
  if (speedMatch) {
    result.speed = speedMatch[1].trim();
  }

  // size= 12345kB or 12345B
  const sizeMatch = msg.match(/size=\s*(\d+)\s*(kB|B|MB)/i);
  if (sizeMatch) {
    const val = parseInt(sizeMatch[1], 10);
    const unit = sizeMatch[2].toUpperCase();
    if (unit === 'KB') {
      result.size = val >= 1024 ? `${(val / 1024).toFixed(1)} MB` : `${val} KB`;
    } else if (unit === 'MB') {
      result.size = `${val} MB`;
    } else {
      result.size = `${val} B`;
    }
  }

  // fps= 60
  const fpsMatch = msg.match(/fps=\s*([\d.]+)/);
  if (fpsMatch) {
    result.fps = fpsMatch[1].trim();
  }

  return result;
}

let lastCompileLogTime = 0;
let lastCompileUpdateTime = 0;

function updateCompileProgress({ phase, timeSec, progressRatio, speed, size, fps }) {
  if (!currentDownload || currentDownload.status !== "compiling") return;

  if (timeSec !== undefined && timeSec > (currentDownload.compileTimeSec || 0)) {
    currentDownload.compileTimeSec = timeSec;
  }
  if (speed) currentDownload.compileSpeed = speed;
  if (size) currentDownload.compileSize = size;
  if (fps) currentDownload.compileFps = fps;

  const totalDur = currentDownload.totalDuration || 0;
  const currentSec = currentDownload.compileTimeSec || 0;

  // Percentage calculation
  let percent = currentDownload.percent;
  if (totalDur > 0 && currentSec > 0) {
    percent = Math.min(99, Math.max(1, Math.round((currentSec / totalDur) * 100)));
  } else if (progressRatio !== null && progressRatio !== undefined && progressRatio > 0) {
    percent = Math.min(99, Math.max(1, Math.round(progressRatio * 100)));
  }
  currentDownload.percent = percent;

  // ETA calculation
  let etaStr = "--:--";
  if (totalDur > 0 && currentSec > 0 && currentDownload.compileSpeed) {
    const speedMultiplier = parseFloat(currentDownload.compileSpeed);
    if (speedMultiplier > 0) {
      const remainingSecs = Math.max(0, (totalDur - currentSec) / speedMultiplier);
      if (remainingSecs < 60) {
        etaStr = `${Math.round(remainingSecs)}s`;
      } else {
        etaStr = `${Math.floor(remainingSecs / 60)}m ${Math.round(remainingSecs % 60)}s`;
      }
    }
  }
  currentDownload.eta = etaStr;

  const phaseLabel = phase === "transcode" ? "Transcoding" : "Remuxing";
  const formattedCur = formatTime(currentSec);
  const formattedTot = totalDur > 0 ? formatTime(totalDur) : null;
  const timeDisplay = formattedTot ? `${formattedCur} / ${formattedTot}` : formattedCur;

  currentDownload.statusText = `${phaseLabel}: ${timeDisplay} (${percent}%)`;
  currentDownload.speed = currentDownload.compileSpeed || (phase === "transcode" ? "Transcoding..." : "Remuxing...");
  currentDownload.timeInfo = timeDisplay;

  const now = Date.now();
  // UI update throttled to 350ms
  if (now - lastCompileUpdateTime >= 350) {
    lastCompileUpdateTime = now;
    sendStatusUpdate({
      stage: phase,
      statusText: currentDownload.statusText,
      timeInfo: timeDisplay,
      compileSpeed: currentDownload.compileSpeed,
      compileSize: currentDownload.compileSize
    });
  }

  // Console terminal log throttled to 1500ms
  if (now - lastCompileLogTime >= 1500) {
    lastCompileLogTime = now;
    const parts = [];
    parts.push(`[${phaseLabel}] ${timeDisplay} (${percent}%)`);
    if (currentDownload.compileSpeed) parts.push(`Speed: ${currentDownload.compileSpeed}`);
    if (currentDownload.compileSize) parts.push(`Size: ${currentDownload.compileSize}`);
    if (etaStr !== "--:--") parts.push(`ETA: ${etaStr}`);
    log(parts.join(" | "), "info");
  }
}

// Merge & Finalize file stream
async function compileSegments(skipFailed = false) {
  // Missing assets cannot be safely joined, especially keys and init segments.
  if (skipFailed) {
    log("Incomplete streams cannot be converted safely. Retry the download.", "error");
    await cleanUpDownload("failed");
    return;
  }

  // 1. Stop download speed timer
  if (currentDownload.speedTimer) {
    clearInterval(currentDownload.speedTimer);
    currentDownload.speedTimer = null;
  }

  currentDownload.status = "compiling";
  currentDownload.stage = "loading_converter";
  currentDownload.percent = 0;
  currentDownload.speed = "--";
  currentDownload.eta = "--:--";
  currentDownload.statusText = "Loading local MP4 converter...";
  sendStatusUpdate();

  let blobUrl;
  try {
    log("Loading local MP4 converter...", "info");
    converter = new FFmpeg();
    let remuxPhase = "remux";
    lastCompileLogTime = 0;
    lastCompileUpdateTime = 0;

    converter.on("progress", ({ progress, time }) => {
      const timeSec = Math.max(0, time / 1000000);
      updateCompileProgress({
        phase: remuxPhase,
        timeSec,
        progressRatio: progress > 0 && progress <= 1 ? progress : null
      });
    });

    converter.on("log", ({ type, message }) => {
      if (!message) return;
      const info = parseFfmpegLog(message);
      if (info.timeSec !== undefined || info.speed || info.size) {
        updateCompileProgress({
          phase: remuxPhase,
          timeSec: info.timeSec,
          speed: info.speed,
          size: info.size,
          fps: info.fps
        });
      }
    });

    await converter.load({
      coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm")
    });

    // 2. Write segments into FFmpeg virtual file system
    currentDownload.stage = "preparing_segments";
    const totalSegs = currentDownload.segments.length;
    log(`Preparing ${totalSegs} media segments for MP4 converter...`, "info");
    let lastWriteStatusTime = Date.now();

    let isFmp4Segments = false;
    for (let i = 0; i < totalSegs; i++) {
      const segment = currentDownload.segments[i];
      const buffer = await getSegmentFromDB(`${currentDownload.id}_${segment.index}`);
      if (!buffer) throw new Error(`Missing segment ${segment.index}`);
      const bytes = new Uint8Array(buffer);
      if (i === 0 && currentDownload.type === "segments" && bytes.length >= 8 && bytes[0] !== 0x47) {
        const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
        if (/^(ftyp|styp|moof)$/.test(box)) isFmp4Segments = true;
      }
      await converter.writeFile(segment.name, bytes);

      const now = Date.now();
      const prepPercent = Math.round(((i + 1) / totalSegs) * 100);
      if (now - lastWriteStatusTime > 400 || i === totalSegs - 1) {
        lastWriteStatusTime = now;
        currentDownload.percent = prepPercent;
        currentDownload.speed = `${i + 1} / ${totalSegs}`;
        currentDownload.statusText = `Preparing segments: ${i + 1}/${totalSegs} (${prepPercent}%)`;
        sendStatusUpdate({
          stage: "preparing_segments",
          statusText: currentDownload.statusText,
          timeInfo: `${i + 1}/${totalSegs}`
        });
      }
    }
    log(`All ${totalSegs} segments loaded into converter.`, "success");

    if (currentDownload.type === "segments") {
      if (isFmp4Segments) {
        // Concatenate fragmented MP4 chunks into a single input file
        const parts = [];
        let totalLen = 0;
        for (const segment of currentDownload.segments) {
          const buffer = await getSegmentFromDB(`${currentDownload.id}_${segment.index}`);
          const arr = new Uint8Array(buffer);
          parts.push(arr);
          totalLen += arr.byteLength;
        }
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const arr of parts) {
          combined.set(arr, offset);
          offset += arr.byteLength;
        }
        await converter.writeFile("input.media", combined);
        currentDownload.inputName = "input.media";
      } else {
        // Build synthetic HLS playlist for MPEG-TS (.dat / .ts) segments
        const playlistLines = [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXT-X-TARGETDURATION:10",
          "#EXT-X-MEDIA-SEQUENCE:0"
        ];
        let prevVariant = null;
        for (const seg of currentDownload.segments) {
          const vKey = seg.usedVariantKey || seg.variantKey || "default";
          if (prevVariant !== null && vKey !== prevVariant) {
            playlistLines.push("#EXT-X-DISCONTINUITY");
          }
          prevVariant = vKey;
          playlistLines.push("#EXTINF:4.000,");
          playlistLines.push(seg.name);
        }
        playlistLines.push("#EXT-X-ENDLIST");
        currentDownload.playlists.set("playlist0.m3u8", playlistLines.join("\n") + "\n");
        currentDownload.inputName = "playlist0.m3u8";
      }
    }

    for (const [name, text] of currentDownload.playlists) {
      await converter.writeFile(name, text);
    }

    // 3. Remux
    currentDownload.stage = "remuxing";
    currentDownload.percent = 0;
    currentDownload.statusText = "Remuxing video and audio into MP4...";
    log("Remuxing video and audio into MP4...", "info");
    sendStatusUpdate();

    const useHlsDemuxer = currentDownload.type === 'm3u8' || (currentDownload.type === 'segments' && !isFmp4Segments);
    const input = useHlsDemuxer
      ? ['-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data', '-i', currentDownload.inputName]
      : ['-i', currentDownload.inputName];
    const base = [...input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'];

    let code = await converter.exec([...base, '-c', 'copy', '-movflags', '+faststart', '-y', 'output.mp4']);

    if (code !== 0) {
      remuxPhase = "transcode";
      currentDownload.stage = "transcoding";
      currentDownload.percent = 0;
      currentDownload.compileTimeSec = 0;
      currentDownload.statusText = "Converting codecs (H.264 / AAC)...";
      log("Converting codecs to H.264 / AAC... This may take several minutes.", "warning");
      sendStatusUpdate();

      code = await converter.exec([
        ...base,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y', 'output.mp4'
      ]);
    }

    if (code !== 0) throw new Error('MP4 conversion failed. Unsupported media or insufficient memory.');

    // 4. Free up memory: batch delete temporary segment files from Wasm converter memory immediately
    log("Purging raw segments from converter memory to free RAM...", "info");
    const filesToDelete = [
      ...currentDownload.segments.map(s => s.name),
      ...Array.from(currentDownload.playlists.keys())
    ];
    try { await converter.deleteFiles(filesToDelete); } catch {}

    // 5. Read output MP4 file as Blob (Zero-copy transfer without duplicate buffer allocation)
    currentDownload.stage = "reading_output";
    currentDownload.percent = 99;
    currentDownload.statusText = "Reading generated MP4 file (Zero-copy)...";
    log("Reading generated MP4 file from converter...", "info");
    sendStatusUpdate();

    const outputResult = await converter.readFile('output.mp4', 'blob');
    let outputBlob;
    if (outputResult instanceof Blob) {
      outputBlob = outputResult;
    } else if (outputResult?.byteLength) {
      outputBlob = new Blob([outputResult], { type: 'video/mp4' });
    } else {
      throw new Error('Empty MP4 output');
    }

    if (!outputBlob.size) throw new Error('Empty MP4 output');

    const outputMb = (outputBlob.size / (1024 * 1024)).toFixed(1);
    log(`MP4 ready (${outputMb} MB). Preparing file save...`, 'success');

    blobUrl = URL.createObjectURL(outputBlob);

    // 6. Save file (Keep converter alive until download is safely finished)
    currentDownload.status = 'saving';
    currentDownload.stage = 'saving';
    currentDownload.percent = 100;
    currentDownload.speed = "Ready";
    currentDownload.statusText = "Saving MP4 file...";
    sendStatusUpdate();

    const saved = new Promise((resolve, reject) => {
      saveResolve = resolve;
      saveReject = reject;
    });
    saved.catch(() => {});

    log("Requesting browser to save file...", "info");
    const response = await chrome.runtime.sendMessage({
      action: 'triggerDownloadsApi',
      data: { url: blobUrl, filename: currentDownload.filename }
    });
    if (!response?.success) throw new Error(response?.error || 'Could not start Chrome download');

    log(`Save process started (ID: ${response.downloadId || 'ok'}). Waiting for completion...`, "info");
    await saved;
    log('MP4 file successfully saved.', 'success');
    await cleanUpDownload('completed');
  } catch (err) {
    if (currentDownload) {
      log(`MP4 conversion/save failed: ${err.message}`, 'error');
      await cleanUpDownload('failed');
    }
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    converter?.terminate();
    converter = null;
    saveResolve = saveReject = null;
  }
}

// Controls
function pauseDownload() {
  if (!currentDownload || currentDownload.isPaused || currentDownload.status !== "downloading") return;
  currentDownload.isPaused = true;
  currentDownload.status = "paused";
  sendStatusUpdate();
  log("Downloading process paused.", "warning");
}

function resumeDownload() {
  if (!currentDownload || !currentDownload.isPaused) return;
  currentDownload.isPaused = false;
  currentDownload.status = "downloading";
  log("Downloading process resumed.", "success");
  fillQueue();
}

function cancelDownload() {
  if (!currentDownload) return;
  currentDownload.abortController.abort();
  converter?.terminate();
  saveReject?.(new Error("Cancelled"));
  currentDownload.isCancelled = true;
  currentDownload.status = "cancelled";
  log("Downloading process cancelled by user.", "error");
  cleanUpDownload("cancelled");
}

async function cleanUpDownload(finalStatus) {
  if (currentDownload) {
    currentDownload.abortController.abort();
    clearInterval(currentDownload.speedTimer);
    await removeDNRRules();
    log("Purging temp buffer cache from database...", "info");
    await clearSegmentsFromDB(currentDownload.id);
  }

  if (currentDownload) { currentDownload.status = finalStatus; sendStatusUpdate(); }

  // Report final results back to service worker
  chrome.runtime.sendMessage({
    action: "offscreenPipelineFinish",
    status: finalStatus
  }).catch(() => {});

  currentDownload = null;
}

function confirmSkipCompile() {
  if (!currentDownload || currentDownload.status !== "waiting_decision") return;
  currentDownload.status = "compiling";
  sendStatusUpdate();
  compileSegments(true);
}
