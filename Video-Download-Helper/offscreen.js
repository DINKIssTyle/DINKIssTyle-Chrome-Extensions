import { FFmpeg } from "./vendor/ffmpeg/index.js";
let converter;
let saveResolve;
let saveReject;
// Headless Offscreen HLS segment Downloader & Compiler

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

// Pipeline Main
async function startDownload(data) {
  try {
    await initDB();
    await clearSegmentsFromDB(data.id);

    currentDownload = {
      id: data.id,
      url: data.url,
      type: data.type,
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
    await setupDNRRules();

    // 2. Fetch and Parse
    log("Fetching index playlist...", "info");
    if (data.type !== "m3u8") {
      currentDownload.inputName = "input.media";
      currentDownload.segments.push({ index: 0, name: "input.media", url: data.url, status: "pending", retryCount: 0 });
    }
    const playlistText = data.type === "m3u8" ? await fetchWithHeaders(currentDownload.url) : null;
    log("Parsing playlist manifest...", "info");
    if (playlistText !== null) currentDownload.inputName = await parsePlaylist(playlistText, currentDownload.url);

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

  const urlObj = new URL(targetUrl);
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
async function parsePlaylist(text, parentUrl, depth = 0) {
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
    const video = await parsePlaylist(await fetchWithHeaders(selected.url), selected.url, depth + 1);
    const audioAttrs = lines.filter(line => line.startsWith('#EXT-X-MEDIA:')).map(attributes)
      .filter(a => a.TYPE === 'AUDIO' && a['GROUP-ID'] === selected.attrs.AUDIO && a.URI)
      .sort((a, b) => Number(b.DEFAULT === 'YES') - Number(a.DEFAULT === 'YES'))[0];
    if (!audioAttrs) return video;
    const audioUrl = new URL(audioAttrs.URI, parentUrl).href;
    const audio = await parsePlaylist(await fetchWithHeaders(audioUrl), audioUrl, depth + 1);
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
  for (let line of lines) {
    if (!line) continue;
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
    const rawBuffer = await fetchWithHeaders(segment.url, "arraybuffer", segment.range);
    let processedBuffer = rawBuffer;

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

// Merge & Finalize file stream
async function compileSegments(skipFailed = false) {
  // Missing assets cannot be safely joined, especially keys and init segments.
  if (skipFailed) { log("Incomplete streams cannot be converted safely. Retry the download.", "error"); await cleanUpDownload("failed"); return; }
  currentDownload.status = "compiling";
  sendStatusUpdate();
  let blobUrl;
  try {
    log("Loading local MP4 converter...", "info");
    converter = new FFmpeg();
    await converter.load({ coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm") });
    for (const segment of currentDownload.segments) {
      const buffer = await getSegmentFromDB(`${currentDownload.id}_${segment.index}`);
      if (!buffer) throw new Error(`Missing segment ${segment.index}`);
      await converter.writeFile(segment.name, new Uint8Array(buffer));
    }
    for (const [name, text] of currentDownload.playlists) await converter.writeFile(name, text);
    const input = currentDownload.type === 'm3u8'
      ? ['-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data', '-i', currentDownload.inputName]
      : ['-i', currentDownload.inputName];
    const base = [...input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'];
    log("Remuxing video and audio into MP4...", "info");
    let code = await converter.exec([...base, '-c', 'copy', '-movflags', '+faststart', '-y', 'output.mp4']);
    if (code !== 0) {
      log("Converting codecs to H.264 / AAC... This may take several minutes.", "warning");
      code = await converter.exec([...base, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', 'output.mp4']);
    }
    if (code !== 0) throw new Error('MP4 conversion failed. Unsupported media or insufficient memory.');
    const output = await converter.readFile('output.mp4');
    if (!output.byteLength) throw new Error('Empty MP4 output');
    blobUrl = URL.createObjectURL(new Blob([output], { type: 'video/mp4' }));
    converter.terminate(); converter = null;
    currentDownload.status = 'saving';
    log('MP4 ready. Choose where to save the file.', 'success');
    const saved = new Promise((resolve, reject) => { saveResolve = resolve; saveReject = reject; });
    // Register completion listener before asking Chrome to save.
    saved.catch(() => {});
    const response = await chrome.runtime.sendMessage({ action: 'triggerDownloadsApi',
      data: { url: blobUrl, filename: currentDownload.filename } });
    if (!response?.success) throw new Error(response?.error || 'Could not start save');
    await saved;
    log('MP4 file saved.', 'success');
    await cleanUpDownload('completed');
  } catch (err) {
    if (currentDownload) { log(`MP4 conversion/save failed: ${err.message}`, 'error'); await cleanUpDownload('failed'); }
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    converter?.terminate(); converter = null;
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
