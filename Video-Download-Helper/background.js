// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
// Media detector background script with Offscreen Downloader orchestrator

const detectedMedia = {};
const metadataByTab = {};
let mediaMetadataStore = {}; // Stores { videoUrl: { title, thumbnail, pageUrl, resolution, duration } }
let activeDownload = null; // Stores current download progress state
const downloadStateReady = chrome.storage.session.get("activeDownload").then(stored => {
  activeDownload = stored.activeDownload || null;
});
function persistDownload() { chrome.storage.session.set({ activeDownload }).catch(() => {}); }
let offscreenCreating = null; // Promisified offscreen status

// Listen for response headers to detect video/audio/m3u8 files
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const url = details.url;
    
    const responseHeaders = details.responseHeaders || [];
    const contentRangeHeader = responseHeaders.find(h => h.name.toLowerCase() === "content-range");
    const contentTypeHeader = responseHeaders.find(
      (h) => h.name.toLowerCase() === "content-type"
    );
    const contentType = contentTypeHeader ? contentTypeHeader.value.toLowerCase() : "";

    let isMedia = false;
    let type = "video";
    let extension = "";

    // 1. Check content-type
    if (
      contentType.includes("video/") ||
      contentType.includes("application/x-mpegurl") ||
      contentType.includes("application/vnd.apple.mpegurl")
    ) {
      isMedia = true;
      type = "video";
    } else if (contentType.includes("audio/")) {
      isMedia = true;
      type = "audio";
    }

    if (contentType.includes("mpegurl")) { type = "m3u8"; extension = "m3u8"; }

    // 2. Check URL extension
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    if (pathname.endsWith(".m3u8") || pathname.endsWith(".m3u")) {
      isMedia = true;
      type = "m3u8";
      extension = "m3u8";
    } else if (pathname.endsWith(".mp4")) {
      isMedia = true;
      type = "video";
      extension = "mp4";
    } else if (pathname.endsWith(".webm")) {
      isMedia = true;
      type = "video";
      extension = "webm";
    } else if (pathname.endsWith(".ogg") || pathname.endsWith(".ogv")) {
      isMedia = true;
      type = "video";
      extension = "ogg";
    } else if (pathname.endsWith(".mp3")) {
      isMedia = true;
      type = "audio";
      extension = "mp3";
    } else if (pathname.endsWith(".wav")) {
      isMedia = true;
      type = "audio";
      extension = "wav";
    } else if (pathname.endsWith(".m4a")) {
      isMedia = true;
      type = "audio";
      extension = "m4a";
    }

    // Skip individual segments
    if (/\.(ts|m4s|aac|vtt|key)$/.test(pathname)) {
      return;
    }

    if (isMedia) {
      if (!detectedMedia[details.tabId]) {
        detectedMedia[details.tabId] = [];
      }

      // Check for duplicate detection
      const exists = detectedMedia[details.tabId].some((item) => item.url === url);
      if (!exists) {
        let filename = pathname.substring(pathname.lastIndexOf("/") + 1) || "Unknown Media";
        try { filename = decodeURIComponent(filename); } catch (e) {}

        // Match metadata fetched by Content Script
        mediaMetadataStore = metadataByTab[details.tabId] || {};
        const matchedMeta = findMetadataMatch(url, details.initiator);
        
        // Try to extract resolution directly from URL first
        const urlResolution = extractResolutionFromUrl(url);

        // Find content-length header
        const contentLengthHeader = responseHeaders.find(
          (h) => h.name.toLowerCase() === "content-length"
        );
        const rangeTotal = contentRangeHeader?.value?.match(/\/(\d+)$/);
        const size = rangeTotal ? Number(rangeTotal[1]) : contentLengthHeader ? parseInt(contentLengthHeader.value, 10) : null;

        const mediaItem = {
          url: url,
          type: type,
          extension: extension || contentType.split(";")[0].split("/")[1] || "unknown",
          filename: matchedMeta ? matchedMeta.title : filename,
          thumbnail: matchedMeta ? matchedMeta.thumbnail : null,
          contentType: contentType,
          detectedAt: Date.now(),
          originUrl: details.initiator || urlObj.origin,
          resolution: urlResolution || (matchedMeta ? matchedMeta.resolution : null),
          duration: matchedMeta ? matchedMeta.duration : null,
          size: size
        };

        detectedMedia[details.tabId].push(mediaItem);
        updateBadge(details.tabId);

        // Asynchronously analyze m3u8 manifest for resolution, duration and size
        if (type === "m3u8") {
          analyzeM3U8(url, details.initiator || urlObj.origin).then((analysis) => {
            if (analysis) {
              const list = detectedMedia[details.tabId];
              if (list) {
                const item = list.find((i) => i.url === url);
                if (item) {
                  if (analysis.resolution) item.resolution = analysis.resolution;
                  if (analysis.duration) item.duration = analysis.duration;
                  if (analysis.size) item.size = Math.round(analysis.size);
                }
              }
            }
          });
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Match media URLs to scraped metadata
function findMetadataMatch(mediaUrl, initiator) {
  // Try exact match
  if (mediaMetadataStore[mediaUrl]) {
    return mediaMetadataStore[mediaUrl];
  }

  // Try matching domains for YouTube
  if (mediaUrl.includes("youtube.com") || mediaUrl.includes("googlevideo.com")) {
    if (mediaMetadataStore["youtube"]) return mediaMetadataStore["youtube"];
  }

  // Check matching by base URL without query strings
  try {
    const mediaBase = mediaUrl.split("?")[0];
    for (let key in mediaMetadataStore) {
      if (key.split("?")[0] === mediaBase) {
        return mediaMetadataStore[key];
      }
    }
  } catch (e) {}

  // Fallback to page-wide meta image
  if (initiator) {
    for (let key in mediaMetadataStore) {
      if (mediaMetadataStore[key].pageUrl && mediaMetadataStore[key].pageUrl.includes(initiator)) {
        // Strip specific video properties (resolution, duration) on generic page metadata matches
        // to prevent wrong values spreading to other detected video streams on the same page.
        const pageMeta = { ...mediaMetadataStore[key] };
        pageMeta.resolution = null;
        pageMeta.duration = null;
        return pageMeta;
      }
    }
  }

  return null;
}

// Clear detected media on tab actions
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    detectedMedia[tabId] = [];
    delete metadataByTab[tabId];
    updateBadge(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedMedia[tabId];
  delete metadataByTab[tabId];
});

function updateBadge(tabId) {
  const count = detectedMedia[tabId] ? detectedMedia[tabId].length : 0;
  chrome.action.setBadgeText({
    tabId: tabId,
    text: count > 0 ? count.toString() : ""
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: "#6366f1"
  });
}

// Handle all Extension runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "discoveredMedia" && sender.tab) {
    const data = message.data;
    let url;
    try { url = new URL(data.url); } catch { return; }
    if (!["http:", "https:"].includes(url.protocol)) return;
    const list = detectedMedia[sender.tab.id] ||= [];
    const existing = list.find(item => item.url === url.href);
    const item = { url: url.href, type: data.type, extension: data.extension,
      filename: data.title || "Web Video", thumbnail: data.thumbnail || null,
      originUrl: sender.url, resolution: data.resolution, duration: data.duration,
      detectedAt: Date.now(), source: data.source };
    if (existing) Object.assign(existing, Object.fromEntries(Object.entries(item).filter(([key, value]) => value != null && key !== "detectedAt")));
    else if (list.length < 500) list.push(item);
    updateBadge(sender.tab.id);
    sendResponse({ success: true });
    return;
  }
  if (message.action === "rescanTab") {
    chrome.webNavigation.getAllFrames({ tabId: message.tabId }).then(frames =>
      Promise.allSettled(frames.map(frame => chrome.tabs.sendMessage(message.tabId,
        { action: "rescanMedia" }, { frameId: frame.frameId }))))
      .then(results => sendResponse({ success: results.some(result => result.status === "fulfilled") }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
  // 1. Content Script metadata parser reports
  if (message.action === "mediaMetadata") {
    const { videoUrl, title, thumbnail, pageUrl, resolution, duration } = message.data;
    if (!sender.tab) return;
    mediaMetadataStore = metadataByTab[sender.tab.id] ||= {};
    mediaMetadataStore[videoUrl] = { title, thumbnail, pageUrl, resolution, duration };
    
    // Update existing detectedMedia entries with new metadata
    for (let tabId of [sender.tab.id]) {
      const list = detectedMedia[tabId];
      if (list) {
        // Match exact url, or youtube generic if applicable
        const item = list.find((i) => i.url === videoUrl || (videoUrl === "youtube" && (i.url.includes("youtube.com") || i.url.includes("googlevideo.com"))));
        if (item) {
          if (title) item.filename = title;
          if (thumbnail) item.thumbnail = thumbnail;
          if (resolution) item.resolution = resolution;
          if (duration) item.duration = duration;
        }
      }
    }
    
    sendResponse({ success: true });
  } 
  
  // 2. Popup queries list of files
  else if (message.action === "getMediaList") {
    const tabId = message.tabId;
    sendResponse({ mediaList: detectedMedia[tabId] || [] });
  } 
  
  // 3. Clear file lists
  else if (message.action === "clearMediaList") {
    const tabId = message.tabId;
    detectedMedia[tabId] = [];
    updateBadge(tabId);
    sendResponse({ success: true });
  } 
  
  // 4. Set DNR Custom Headers
  else if (message.action === "setDNRRules") {
    const { ruleId, urlFilter, headers } = message.data;
    const requestHeaders = Object.keys(headers).map((name) => ({
      header: name,
      operation: "set",
      value: headers[name]
    }));

    chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders },
        condition: { urlFilter, initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest", "media", "sub_frame"] }
      }],
      removeRuleIds: [ruleId]
    }).then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  } 
  
  // 5. Clear DNR Custom Headers
  else if (message.action === "clearDNRRules") {
    const { ruleIds } = message.data;
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 5.5. Delegate downloads execution from offscreen document
  else if (message.action === "triggerDownloadsApi") {
    const { url, filename } = message.data;
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        if (activeDownload) { activeDownload.downloadId = downloadId; persistDownload(); }
        sendResponse({ success: true, downloadId: downloadId });
      }
    });
    return true;
  }

  // 6. Popup starts an HLS M3U8 download
  else if (message.action === "startHlsDownload") {
    const downloadData = message.data;
    
    if (activeDownload && !["completed", "failed", "cancelled"].includes(activeDownload.status)) {
      sendResponse({ success: false, error: "다른 다운로드가 진행 중입니다." });
      return;
    }
    const finalFilename = mp4Filename(downloadData.filename);
    setupOffscreenDocument().then(() => {
      activeDownload = {
        id: Date.now().toString(),
        url: downloadData.url,
        filename: finalFilename,
        type: downloadData.type || "m3u8",
        referer: downloadData.referer || "",
        origin: downloadData.origin || "",
        status: "initializing",
        percent: 0,
        downloadedCount: 0,
        totalCount: 0,
        speed: "0 KB/s",
        eta: "--:--",
        logs: ["[System] Offscreen downloader thread spawned."]
      };
      
      persistDownload();
      // Send download trigger to Offscreen
      chrome.runtime.sendMessage({
        action: "triggerOffscreenDownload",
        data: activeDownload
      });

      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // 7. Offscreen broadcasts progress reports
  else if (message.action === "offscreenProgressUpdate") {
    if (activeDownload) {
      activeDownload = { ...activeDownload, ...message.data, logs: [...(activeDownload.logs || []), ...(message.data.logs || [])].slice(-300) };
      persistDownload();
      // Forward status to active Popup if it is currently open
      chrome.runtime.sendMessage({
        action: "popupProgressBroadcast",
        data: { ...activeDownload, logs: message.data.logs || [] }
      }).catch(() => {
        // Suppress errors when popup is closed (normal browser behavior)
      });
    }
    sendResponse({ success: true });
  }

  // 8. Popup queries current downloading state
  else if (message.action === "getDownloadStatus") {
    downloadStateReady.then(() => sendResponse({ activeDownload }));
    return true;
  }

  // 9. Popup control actions (Pause/Resume/Cancel) forwarders
  else if (message.action === "pauseHlsDownload") {
    chrome.runtime.sendMessage({ action: "offscreenPause" });
    if (activeDownload) activeDownload.status = "paused";
    sendResponse({ success: true });
  } 
  else if (message.action === "resumeHlsDownload") {
    chrome.runtime.sendMessage({ action: "offscreenResume" });
    if (activeDownload) activeDownload.status = "downloading";
    sendResponse({ success: true });
  } 
  else if (message.action === "cancelHlsDownload") {
    chrome.runtime.sendMessage({ action: "offscreenCancel" });
    closeOffscreenDocument().then(() => {
      activeDownload = null;
      persistDownload();
      sendResponse({ success: true });
    });
    return true;
  }
  else if (message.action === "confirmSkipCompile") {
    chrome.runtime.sendMessage({ action: "offscreenConfirmSkip" });
    if (activeDownload) activeDownload.status = "compiling";
    sendResponse({ success: true });
  }

  // 10. Offscreen reports finish pipeline
  else if (message.action === "offscreenPipelineFinish") {
    const finalStatus = message.status;
    if (activeDownload) {
      activeDownload.status = finalStatus;
      persistDownload();
    }
    closeOffscreenDocument();
    sendResponse({ success: true });
  }
});

// Helper: Setup Offscreen Document (Safe Multi-call check)
async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  
  // Check if already exists
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ["LOCAL_STORAGE", "BLOBS", "WORKERS"], // Accessing IndexedDB counts as local storage reason
    justification: "HLS segment buffering and file concatenation in background"
  });

  try { await offscreenCreating; } finally { offscreenCreating = null; }
}

// Helper: Close Offscreen Document
async function closeOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

// Asynchronously analyze m3u8 playlist manifest to extract resolution, duration, and size
async function analyzeM3U8(url, originUrl, depth = 0) {
  if (depth > 5) return null;
  try {
    const headers = {};
    if (originUrl) {
      headers["Referer"] = originUrl;
      try {
        headers["Origin"] = new URL(originUrl).origin;
      } catch (e) {
        headers["Origin"] = originUrl;
      }
    }
    const response = await fetch(url, { headers, cache: "no-cache", credentials: "include" });
    if (!response.ok) return null;
    const text = await response.text();
    
    const lines = text.split("\n");
    const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
    
    let isMaster = false;
    let resolutions = [];
    let bandwidths = [];
    let maxBandwidthUrl = "";
    let maxBandwidth = 0;
    let duration = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        isMaster = true;
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
        if (resMatch) resolutions.push(resMatch[1]);
        
        const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        if (bw) bandwidths.push(bw);
        
        let nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
        if (nextLine && !nextLine.startsWith("#")) {
          const absUrl = makeAbsoluteUrl(nextLine, baseUrl);
          if (bw > maxBandwidth) {
            maxBandwidth = bw;
            maxBandwidthUrl = absUrl;
          }
        }
      }
      
      if (line.startsWith("#EXTINF")) {
        const durMatch = line.match(/#EXTINF:([0-9.]+)/i);
        if (durMatch) {
          duration += parseFloat(durMatch[1]);
        }
      }
    }
    
    if (isMaster && maxBandwidthUrl) {
      const subRes = await analyzeM3U8(maxBandwidthUrl, originUrl, depth + 1);
      if (subRes) {
        return {
          resolution: resolutions.length > 0 ? resolutions[resolutions.length - 1] : subRes.resolution,
          duration: subRes.duration,
          size: subRes.duration * maxBandwidth / 8
        };
      }
    }
    
    return {
      resolution: resolutions.length > 0 ? resolutions[0] : null,
      duration: duration > 0 ? duration : null,
      size: (duration > 0 && maxBandwidth > 0) ? (duration * maxBandwidth / 8) : null
    };
  } catch (e) {
    console.error("Failed to analyze m3u8:", e);
    return null;
  }
}

// Extract Resolution pattern from URL string
function extractResolutionFromUrl(url) {
  // 1. Match formats like 1920x1080, 720x1280, etc.
  const resMatch = url.match(/(\d{3,4})[xX](\d{3,4})/);
  if (resMatch) {
    return `${resMatch[1]}x${resMatch[2]}`;
  }
  
  // 2. Match formats like 1080p, 720p, etc.
  const pMatch = url.match(/_?(\d{3,4})[pP]\b/);
  if (pMatch) {
    const height = pMatch[1];
    if (height === "1080") return "1920x1080";
    if (height === "720") return "1280x720";
    if (height === "480") return "854x480";
    if (height === "360") return "640x360";
    if (height === "240") return "426x240";
    return `${height}p`;
  }
  
  return null;
}

function mp4Filename(name = "video") {
  const stem = name.split(/[?#]/)[0].replace(/\.(m3u8?|mp4|webm|og[gv]|mov|mkv|ts|m4v)$/i, "");
  return (stem.replace(/[\/\\?%*:|"<>\x00-\x1f]/g, "_").trim().slice(0, 180) || "video") + ".mp4";
}
function makeAbsoluteUrl(path, base) { return new URL(path, base).href; }
chrome.downloads.onChanged.addListener(delta => {
  if (activeDownload?.downloadId !== delta.id || !delta.state) return;
  chrome.runtime.sendMessage({ action: "offscreenSaveState", state: delta.state.current,
    error: delta.error?.current }).catch(() => {});
});
