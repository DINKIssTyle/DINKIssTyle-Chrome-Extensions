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
  if (message.action === "triggerOffscreenDownload") {
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
      filename: data.filename,
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
    const playlistText = await fetchWithHeaders(currentDownload.url);
    log("Parsing playlist manifest...", "info");
    await parsePlaylist(playlistText, currentDownload.url);

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
async function setupDNRRules() {
  if (!currentDownload.referer && !currentDownload.origin) return;

  const urlObj = new URL(currentDownload.url);
  const filter = `${urlObj.protocol}//${urlObj.hostname}/*`;
  const headers = {};
  if (currentDownload.referer) headers["Referer"] = currentDownload.referer;
  if (currentDownload.origin) headers["Origin"] = currentDownload.origin;

  log(`Registering custom headers (Referer/Origin) for: ${urlObj.hostname}`, "system");

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: "setDNRRules",
      data: {
        ruleId: currentDownload.ruleId,
        urlFilter: filter,
        headers: headers
      }
    }, (res) => {
      if (res && res.success) log("Session headers injected.", "success");
      resolve();
    });
  });
}

// Clear DNR rules from Background
async function removeDNRRules() {
  if (!currentDownload || !currentDownload.ruleId) return;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: "clearDNRRules",
      data: { ruleIds: [currentDownload.ruleId] }
    }, () => resolve());
  });
}

// Fetch Helper
async function fetchWithHeaders(targetUrl, responseType = "text") {
  const options = { method: "GET", cache: "no-cache" };
  const response = await fetch(targetUrl, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  
  if (responseType === "arraybuffer") return await response.arrayBuffer();
  return await response.text();
}

// Parse Playlist
async function parsePlaylist(text, parentUrl) {
  const lines = text.split("\n");
  const baseUrl = parentUrl.substring(0, parentUrl.lastIndexOf("/") + 1);
  
  let isMasterPlaylist = false;
  let maxBandwidthUrl = "";
  let maxBandwidth = 0;

  let keyUrl = "";
  let aesMethod = null;
  let ivHex = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-STREAM-INF")) {
      isMasterPlaylist = true;
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
      
      let nextLineUrl = lines[i + 1] ? lines[i + 1].trim() : "";
      if (nextLineUrl && !nextLineUrl.startsWith("#")) {
        const absoluteSubUrl = makeAbsoluteUrl(nextLineUrl, baseUrl);
        if (bandwidth > maxBandwidth) {
          maxBandwidth = bandwidth;
          maxBandwidthUrl = absoluteSubUrl;
        }
      }
    }

    if (line.startsWith("#EXT-X-KEY")) {
      const methodMatch = line.match(/METHOD=([^,\s]+)/i);
      const uriMatch = line.match(/URI="([^"]+)"/i);
      const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);

      if (methodMatch) aesMethod = methodMatch[1].toUpperCase();
      if (uriMatch) keyUrl = makeAbsoluteUrl(uriMatch[1], baseUrl);
      if (ivMatch) ivHex = ivMatch[1];
    }

    if (line.startsWith("#EXTINF")) {
      let nextLineUrl = lines[i + 1] ? lines[i + 1].trim() : "";
      let offset = 1;
      while (nextLineUrl.startsWith("#") && i + 1 + offset < lines.length) {
        offset++;
        nextLineUrl = lines[i + 1 + offset] ? lines[i + 1 + offset].trim() : "";
      }
      
      if (nextLineUrl && !nextLineUrl.startsWith("#")) {
        currentDownload.segments.push({
          index: currentDownload.segments.length,
          url: makeAbsoluteUrl(nextLineUrl, baseUrl),
          status: "pending",
          retryCount: 0
        });
      }
    }
  }

  if (isMasterPlaylist && maxBandwidthUrl) {
    log(`Master stream redirection. Selecting high bandwidth: ${maxBandwidth} Bps`, "info");
    const childText = await fetchWithHeaders(maxBandwidthUrl);
    return await parsePlaylist(childText, maxBandwidthUrl);
  }

  if (aesMethod && aesMethod !== "NONE") {
    if (aesMethod === "AES-128" && keyUrl) {
      log("Decryption required. Importing AES-128 Key...", "warning");
      const keyBuffer = await fetchWithHeaders(keyUrl, "arraybuffer");
      currentDownload.aesMethod = aesMethod;
      currentDownload.decryptionKey = await crypto.subtle.importKey(
        "raw", keyBuffer, { name: "AES-CBC" }, false, ["decrypt"]
      );
      if (ivHex) currentDownload.iv = hexToUint8Array(ivHex);
      log("AES key imported successfully.", "success");
    } else {
      throw new Error(`Unsupported stream decryption method: ${aesMethod}`);
    }
  }
}

function makeAbsoluteUrl(path, baseUrl) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/")) {
    const urlObj = new URL(baseUrl);
    return `${urlObj.origin}${path}`;
  }
  return `${baseUrl}${path}`;
}

function hexToUint8Array(hex) {
  const cleanHex = hex.length % 2 !== 0 ? `0${hex}` : hex;
  const arr = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return arr;
}

function getSequenceIV(sequence) {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(12, sequence);
  return iv;
}

async function decryptSegment(encryptedBuffer, seqNumber) {
  if (!currentDownload.decryptionKey) return encryptedBuffer;
  const iv = currentDownload.iv || getSequenceIV(seqNumber);
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: iv },
      currentDownload.decryptionKey,
      encryptedBuffer
    );
  } catch (e) {
    throw new Error(`Decryption failed on segment #${seqNumber}: ${e.message}`);
  }
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
        currentDownload.status = "waiting_decision";
        currentDownload.failedCount = failedCount;
        log(`[warning] ${failedCount} segments failed. Waiting for user decision to skip and compile or cancel...`, "warning");
        sendStatusUpdate({ failedCount: failedCount });
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
    const rawBuffer = await fetchWithHeaders(segment.url, "arraybuffer");
    let processedBuffer = rawBuffer;

    if (currentDownload.aesMethod) {
      processedBuffer = await decryptSegment(rawBuffer, segment.index);
    }

    await saveSegmentToDB(segmentKey, processedBuffer);

    segment.status = "completed";
    currentDownload.downloadedCount++;
    currentDownload.bytesDownloaded += processedBuffer.byteLength;
    currentDownload.percent = Math.floor((currentDownload.downloadedCount / currentDownload.segments.length) * 100);

    sendStatusUpdate();

  } catch (err) {
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
  log("All segments buffered. Initializing sequential compilation...", "success");
  clearInterval(currentDownload.speedTimer);
  
  const total = currentDownload.segments.length;
  const chunkList = [];

  try {
    for (let i = 0; i < total; i++) {
      const segmentKey = `${currentDownload.id}_${i}`;
      const buffer = await getSegmentFromDB(segmentKey);
      if (!buffer) {
        if (skipFailed) {
          log(`Missing segment #${i} due to download failure. Skipping this chunk.`, "warning");
          continue;
        }
        throw new Error(`Missing buffer block #${i}`);
      }
      chunkList.push(buffer);

      if (i % 50 === 0 || i === total - 1) {
        log(`Compiling chunks: ${i + 1} / ${total}`, "info");
      }
    }

    log("Creating unified local Blob...", "info");
    const outputBlob = new Blob(chunkList, { type: "video/mp2t" });
    const localBlobUrl = URL.createObjectURL(outputBlob);

    log("Unified local Blob created. Requesting Downloads API to Service Worker...", "info");
    
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: "triggerDownloadsApi",
        data: {
          url: localBlobUrl,
          filename: currentDownload.filename
        }
      }, (response) => {
        if (response && response.success) {
          log("Download trigger acknowledged by Service Worker. Initiating save...", "success");
          // Hold the offscreen context alive for 8 seconds to prevent Blob URL revocation
          setTimeout(() => {
            log("Pipeline complete. File saved.", "success");
            resolve();
          }, 8000);
        } else {
          reject(new Error(response ? response.error : "Unknown downloads error"));
        }
      });
    });

    cleanUpDownload("completed");

  } catch (err) {
    log(`Compilation crash: ${err.message}`, "error");
    cleanUpDownload("failed");
  }
}

// Controls
function pauseDownload() {
  if (!currentDownload || currentDownload.isPaused) return;
  currentDownload.isPaused = true;
  currentDownload.status = "paused";
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
  currentDownload.isCancelled = true;
  currentDownload.status = "cancelled";
  log("Downloading process cancelled by user.", "error");
  cleanUpDownload("cancelled");
}

async function cleanUpDownload(finalStatus) {
  if (currentDownload) {
    clearInterval(currentDownload.speedTimer);
    await removeDNRRules();
    log("Purging temp buffer cache from database...", "info");
    await clearSegmentsFromDB(currentDownload.id);
  }

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
