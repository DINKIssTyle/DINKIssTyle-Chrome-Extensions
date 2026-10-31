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

const GENERIC_MEDIA_NAMES = new Set([
  "unknown media", "web video", "video", "master", "index", "playlist", "manifest", "stream", "play"
]);

function isGenericFilename(name) {
  if (!name) return true;
  const stem = name.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase();
  if (!stem || GENERIC_MEDIA_NAMES.has(stem)) return true;
  if (/^(?:v\d+[_.-]?|seg(?:ment)?[_.-]?|chunk[_.-]?|frag(?:ment)?[_.-]?|part[_.-]?)?\d+$/i.test(stem)) return true;
  return false;
}

function normalizeVariantPattern(str) {
  return str
    .replace(/(^|[_.-])v\d+(?=[_.-]|$)/gi, "$1v*")
    .replace(/(^|[_.-])\d{3,4}[pP](?=[_.-]|$)/g, "$1*p")
    .replace(/(^|[_.-])(?:low|med|medium|high|uhd|fhd|hd|sd)(?=[_.-]|$)/gi, "$1*");
}

function parseSegmentUrl(url, contentType = "") {
  let urlObj;
  try { urlObj = new URL(url); } catch { return null; }
  const pathname = urlObj.pathname;
  const slashIdx = pathname.lastIndexOf("/");
  const dirPath = slashIdx >= 0 ? pathname.substring(0, slashIdx + 1) : "/";
  const baseUrl = urlObj.origin + dirPath;
  const file = slashIdx >= 0 ? pathname.substring(slashIdx + 1) : pathname;
  const extMatch = file.match(/(\.[a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1] : "";
  const extLower = ext.toLowerCase();
  const stem = ext ? file.slice(0, -ext.length) : file;

  const isMp2t = contentType.includes("mp2t") || contentType.includes("mpeg-tts") || contentType.includes("iso.segment");
  const isSegExt = /^\.(ts|m4s|m4f|cmfv|cmfa|mp2t|seg|chunk)$/i.test(extLower);
  const isDatOrBin = /^\.(dat|bin)$/i.test(extLower);

  let prefix = null;
  let indexStr = null;
  let suffix = ext;

  // 1. Check middle segment index pattern like seg-1-v1-a1.ts or chunk_0001_v0.dat
  const midMatch = stem.match(/^((?:.*[_.-])?(?:seg(?:ment)?|chunk|frag(?:ment)?|part)[_.-]?)(\d{1,7})([_.-].*)$/i);
  if (midMatch) {
    prefix = midMatch[1];
    indexStr = midMatch[2];
    suffix = midMatch[3] + ext;
  } else {
    // 2. Check trailing digits on stem like v1_0000.dat, v0_0001.dat, segment001.ts, 0001.dat
    const endMatch = stem.match(/^(.*?\D|^)(\d{1,7})$/);
    if (endMatch) {
      const candPrefix = endMatch[1];
      const candIndexStr = endMatch[2];
      // Require either known segment mime/ext, or a clear numbered segment pattern (e.g. v0_0001.dat, seg_1.mp4, or >=3 zero-padded digits with .dat/.bin)
      const hasSegmentMarker = /(?:^|[_.-])(?:v\d+|seg(?:ment)?|chunk|frag(?:ment)?|part)[_.-]?$/i.test(candPrefix);
      const hasPaddedDigits = candIndexStr.length >= 3 && candIndexStr.startsWith("0");
      if (isMp2t || isSegExt || (isDatOrBin && (hasSegmentMarker || hasPaddedDigits || candIndexStr.length >= 2)) || hasSegmentMarker) {
        prefix = candPrefix;
        indexStr = candIndexStr;
        suffix = ext;
      }
    }
  }

  if (indexStr !== null) {
    const index = parseInt(indexStr, 10);
    const padWidth = (indexStr.startsWith("0") && indexStr.length > 1) ? indexStr.length : 0;
    const normPrefix = normalizeVariantPattern(prefix);
    const normSuffix = normalizeVariantPattern(suffix);
    const groupKey = `${baseUrl}|${normPrefix}{#}${normSuffix}`;
    const variantKey = `${prefix}|${padWidth}|${suffix}`;
    const cleanStem = prefix.replace(/[_.-]+$/, "") || "video";
    return {
      isSegment: true,
      groupKey,
      variantKey,
      baseUrl,
      prefix,
      padWidth,
      suffix,
      query: urlObj.search || "",
      index,
      cleanName: cleanStem,
      extension: isMp2t ? "mp2t" : (extLower.replace(/^\./, "") || "mp2t")
    };
  }

  if (isMp2t || isSegExt) {
    const groupKey = `${baseUrl}|*${extLower || ".mp2t"}`;
    return {
      isSegment: true,
      groupKey,
      variantKey: `raw|0|${extLower}`,
      baseUrl,
      prefix: null,
      padWidth: 0,
      suffix: ext,
      query: urlObj.search || "",
      index: null,
      cleanName: stem || "video",
      extension: isMp2t ? "mp2t" : (extLower.replace(/^\./, "") || "mp2t")
    };
  }

  return null;
}

function recordSegmentMedia(tabId, details, segInfo, size, contentType) {
  if (!detectedMedia[tabId]) {
    detectedMedia[tabId] = [];
  }
  const list = detectedMedia[tabId];
  mediaMetadataStore = metadataByTab[tabId] || {};
  const matchedMeta = findMetadataMatch(details.url, details.initiator);
  const urlResolution = extractResolutionFromUrl(details.url);

  let item = list.find(i => i.type === "segments" && i.groupKey === segInfo.groupKey);
  if (!item) {
    const defaultName = (matchedMeta && matchedMeta.title) ? matchedMeta.title : `${segInfo.cleanName}.mp4`;
    item = {
      url: details.url,
      type: "segments",
      groupKey: segInfo.groupKey,
      baseUrl: segInfo.baseUrl,
      extension: segInfo.extension || "mp2t",
      filename: defaultName,
      thumbnail: matchedMeta ? matchedMeta.thumbnail : null,
      contentType: contentType,
      detectedAt: Date.now(),
      originUrl: details.initiator || new URL(details.url).origin,
      resolution: urlResolution || (matchedMeta ? matchedMeta.resolution : null),
      duration: matchedMeta ? matchedMeta.duration : null,
      size: 0,
      segmentCount: 0,
      segmentGroup: {
        groupKey: segInfo.groupKey,
        baseUrl: segInfo.baseUrl,
        variants: {},
        observedSegments: [],
        totalObservedBytes: 0
      }
    };
    list.push(item);
  }

  const group = item.segmentGroup;
  const seqIndex = segInfo.index !== null ? segInfo.index : group.observedSegments.length;

  // Record variant stats if template-based
  if (segInfo.prefix !== null) {
    let variant = group.variants[segInfo.variantKey];
    if (!variant) {
      variant = {
        variantKey: segInfo.variantKey,
        baseUrl: segInfo.baseUrl,
        prefix: segInfo.prefix,
        padWidth: segInfo.padWidth,
        suffix: segInfo.suffix,
        query: segInfo.query,
        count: 0,
        totalBytes: 0,
        avgSize: 0,
        minIndex: seqIndex,
        maxIndex: seqIndex,
        sampleUrl: details.url
      };
      group.variants[segInfo.variantKey] = variant;
    }
    variant.query = segInfo.query || variant.query;
    variant.sampleUrl = details.url;
    if (seqIndex < variant.minIndex) variant.minIndex = seqIndex;
    if (seqIndex > variant.maxIndex) variant.maxIndex = seqIndex;
  }

  const existingSeg = group.observedSegments.find(s => s.index === seqIndex && s.variantKey === segInfo.variantKey);
  if (!existingSeg) {
    group.observedSegments.push({
      index: seqIndex,
      url: details.url,
      variantKey: segInfo.variantKey,
      size: size || 0
    });
    group.observedSegments.sort((a, b) => a.index - b.index);
    if (size && size > 0) {
      group.totalObservedBytes += size;
    }
    if (segInfo.prefix !== null && group.variants[segInfo.variantKey]) {
      const v = group.variants[segInfo.variantKey];
      v.count++;
      if (size && size > 0) {
        v.totalBytes += size;
        v.avgSize = Math.round(v.totalBytes / v.count);
      }
    }
  }

  // Pick primary variant URL & clean name
  const variantsList = Object.values(group.variants);
  if (variantsList.length > 0) {
    variantsList.sort((a, b) => {
      const aMulti = a.count >= 2 ? 1 : 0;
      const bMulti = b.count >= 2 ? 1 : 0;
      if (aMulti !== bMulti) return bMulti - aMulti;
      if ((b.avgSize || 0) !== (a.avgSize || 0)) return (b.avgSize || 0) - (a.avgSize || 0);
      return b.count - a.count;
    });
    const best = variantsList[0];
    item.url = best.sampleUrl || item.url;
    if (isGenericFilename(item.filename)) {
      const bestClean = best.prefix.replace(/[_.-]+$/, "") || segInfo.cleanName || "video";
      item.filename = (matchedMeta && matchedMeta.title) ? matchedMeta.title : `${bestClean}.mp4`;
    }
  }

  if (matchedMeta) {
    if (matchedMeta.title && isGenericFilename(item.filename)) item.filename = matchedMeta.title;
    if (matchedMeta.thumbnail && !item.thumbnail) item.thumbnail = matchedMeta.thumbnail;
    if (matchedMeta.resolution && !item.resolution) item.resolution = matchedMeta.resolution;
    if (matchedMeta.duration && !item.duration) item.duration = matchedMeta.duration;
  }
  if (urlResolution && !item.resolution) item.resolution = urlResolution;

  item.segmentCount = new Set(group.observedSegments.map(s => s.index)).size;
  if (group.totalObservedBytes > 0) {
    item.size = group.totalObservedBytes;
  }

  updateBadge(tabId);
}

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

    // Skip non-video auxiliary segment files
    if (/\.(aac|vtt|key)$/.test(pathname)) {
      return;
    }

    // Find content-length header early for both segments and direct media
    const contentLengthHeader = responseHeaders.find(
      (h) => h.name.toLowerCase() === "content-length"
    );
    const rangeTotal = contentRangeHeader?.value?.match(/\/(\d+)$/);
    const size = rangeTotal ? Number(rangeTotal[1]) : contentLengthHeader ? parseInt(contentLengthHeader.value, 10) : null;

    // Check if this is a split video segment (e.g. MP2T .dat, .ts, .m4s, or numbered chunks)
    if (type !== "m3u8") {
      const segInfo = parseSegmentUrl(url, contentType);
      if (segInfo && segInfo.isSegment) {
        // Ignore tiny init/probe responses if needed, otherwise group into a single stream item
        recordSegmentMedia(details.tabId, details, segInfo, size, contentType);
        return;
      }
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

        const mediaItem = {
          url: url,
          type: type,
          extension: extension || contentType.split(";")[0].split("/")[1] || "unknown",
          filename: (matchedMeta && matchedMeta.title) ? matchedMeta.title : filename,
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
                  if (analysis.subPlaylistUrls) item.subPlaylistUrls = analysis.subPlaylistUrls;
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

// Build filtered/unified media list for a tab (hiding redundant segment groups when M3U8 is present)
function getVisibleMediaList(tabId) {
  const list = detectedMedia[tabId] || [];
  if (list.length <= 1) return list;

  const m3u8Items = list.filter(i => i.type === "m3u8");
  const subUrls = new Set();
  for (const m of m3u8Items) {
    if (Array.isArray(m.subPlaylistUrls)) {
      for (const u of m.subPlaylistUrls) subUrls.add(u);
    }
  }

  return list.filter(item => {
    // If this m3u8 is a variant sub-playlist of an already-detected master playlist, hide the duplicate
    if (item.type === "m3u8" && subUrls.has(item.url)) {
      return false;
    }
    // If this is a grouped segment stream and an m3u8 playlist was already detected on the same tab/origin, attach segmentGroup as fallback and hide the duplicate entry
    if (item.type === "segments" && m3u8Items.length > 0) {
      const matchingM3u8 = m3u8Items.find(m => {
        try {
          const mOrigin = new URL(m.url).origin;
          const sOrigin = new URL(item.baseUrl || item.url).origin;
          return mOrigin === sOrigin || m.url.startsWith("blob:");
        } catch {
          return true;
        }
      }) || m3u8Items[0];
      if (matchingM3u8) {
        matchingM3u8.segmentGroup = item.segmentGroup;
        if (!matchingM3u8.size && item.size) matchingM3u8.size = item.size;
        return false;
      }
    }
    return true;
  });
}

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

  // Fallback to page-wide meta (including page metadata reported from MSE/blob players)
  for (let key in mediaMetadataStore) {
    const entry = mediaMetadataStore[key];
    if (!entry) continue;
    if (key === "__page__" || (initiator && entry.pageUrl && entry.pageUrl.includes(initiator))) {
      return { ...entry };
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
  const visible = getVisibleMediaList(tabId);
  const count = visible.length;
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
    const isBlobM3u8 = url.protocol === "blob:" && data.type === "m3u8" && data.manifestText;
    if (!["http:", "https:"].includes(url.protocol) && !isBlobM3u8) return;

    // Store page metadata whenever content script reports media with title/thumbnail/resolution/duration
    if (data.title || data.thumbnail || data.resolution || data.duration) {
      const tabMeta = metadataByTab[sender.tab.id] ||= {};
      const existingPageMeta = tabMeta["__page__"] || {};
      tabMeta["__page__"] = {
        title: (data.title && data.title !== "Web Video") ? data.title : existingPageMeta.title,
        thumbnail: data.thumbnail || existingPageMeta.thumbnail || null,
        pageUrl: sender.url || existingPageMeta.pageUrl,
        resolution: data.resolution || existingPageMeta.resolution || null,
        duration: data.duration || existingPageMeta.duration || null
      };
    }

    // Don't add individual segments discovered in DOM as standalone videos
    if (data.type !== "m3u8") {
      const segInfo = parseSegmentUrl(url.href, "");
      if (segInfo && segInfo.isSegment) {
        sendResponse({ success: true });
        return;
      }
    }

    const list = detectedMedia[sender.tab.id] ||= [];
    const existing = list.find(item => item.url === url.href);
    const item = {
      url: url.href,
      type: data.type,
      extension: data.extension,
      filename: data.title || "Web Video",
      thumbnail: data.thumbnail || null,
      originUrl: sender.url,
      resolution: data.resolution,
      duration: data.duration,
      manifestText: data.manifestText || null,
      manifestBaseUrl: data.manifestBaseUrl || sender.url || null,
      detectedAt: Date.now(),
      source: data.source
    };
    if (existing) {
      Object.assign(existing, Object.fromEntries(Object.entries(item).filter(([key, value]) => value != null && key !== "detectedAt")));
    } else if (list.length < 500) {
      list.push(item);
      if (data.type === "m3u8") {
        analyzeM3U8(url.href, sender.url, 0, data.manifestText, data.manifestBaseUrl || sender.url).then((analysis) => {
          if (analysis) {
            const target = list.find(i => i.url === url.href);
            if (target) {
              if (analysis.resolution && !target.resolution) target.resolution = analysis.resolution;
              if (analysis.duration && !target.duration) target.duration = analysis.duration;
              if (analysis.size && !target.size) target.size = Math.round(analysis.size);
              if (analysis.subPlaylistUrls) target.subPlaylistUrls = analysis.subPlaylistUrls;
            }
          }
        });
      }
    }
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
    if (videoUrl) {
      mediaMetadataStore[videoUrl] = { title, thumbnail, pageUrl, resolution, duration };
    }
    const prevPage = mediaMetadataStore["__page__"] || {};
    mediaMetadataStore["__page__"] = {
      title: (title && title !== "Web Video") ? title : prevPage.title,
      thumbnail: thumbnail || prevPage.thumbnail || null,
      pageUrl: pageUrl || sender.url || prevPage.pageUrl,
      resolution: resolution || prevPage.resolution || null,
      duration: duration || prevPage.duration || null
    };
    
    // Update existing detectedMedia entries with new metadata
    for (let tabId of [sender.tab.id]) {
      const list = detectedMedia[tabId];
      if (list) {
        for (const item of list) {
          const isExact = item.url === videoUrl || (videoUrl === "youtube" && (item.url.includes("youtube.com") || item.url.includes("googlevideo.com")));
          const isStreamItem = item.type === "m3u8" || item.type === "segments";
          if (isExact || isStreamItem) {
            if (title && (isExact || isGenericFilename(item.filename))) item.filename = title;
            if (thumbnail && !item.thumbnail) item.thumbnail = thumbnail;
            if (resolution && !item.resolution) item.resolution = resolution;
            if (duration && !item.duration) item.duration = duration;
          }
        }
      }
    }
    
    sendResponse({ success: true });
  } 
  
  // 2. Popup queries list of files
  else if (message.action === "getMediaList") {
    const tabId = message.tabId;
    sendResponse({ mediaList: getVisibleMediaList(tabId) });
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

  // 6. Popup starts an HLS M3U8 or Segmented Stream download
  else if (message.action === "startHlsDownload") {
    const downloadData = message.data;
    
    if (activeDownload && !["completed", "failed", "cancelled"].includes(activeDownload.status)) {
      sendResponse({ success: false, error: "다른 다운로드가 진행 중입니다." });
      return;
    }

    // Enrich with latest segmentGroup / manifestText from detectedMedia if available
    let matchedItem = null;
    const tabList = downloadData.tabId ? (detectedMedia[downloadData.tabId] || []) : Object.values(detectedMedia).flat();
    if (downloadData.groupKey) {
      matchedItem = tabList.find(i => i.groupKey === downloadData.groupKey);
    }
    if (!matchedItem) {
      matchedItem = tabList.find(i => i.url === downloadData.url);
    }
    const fallbackSegItem = tabList.find(i => i.type === "segments");

    const finalFilename = mp4Filename(downloadData.filename);
    setupOffscreenDocument().then(() => {
      activeDownload = {
        id: Date.now().toString(),
        url: downloadData.url,
        filename: finalFilename,
        type: downloadData.type || "m3u8",
        referer: downloadData.referer || "",
        origin: downloadData.origin || "",
        manifestText: downloadData.manifestText || matchedItem?.manifestText || null,
        manifestBaseUrl: downloadData.manifestBaseUrl || matchedItem?.manifestBaseUrl || null,
        segmentGroup: downloadData.segmentGroup || matchedItem?.segmentGroup || fallbackSegItem?.segmentGroup || null,
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
async function analyzeM3U8(url, originUrl, depth = 0, providedText = null, baseUrlOverride = null) {
  if (depth > 5) return null;
  try {
    let text = providedText;
    if (!text) {
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
      text = await response.text();
    }
    
    const lines = text.split("\n");
    const effectiveBase = baseUrlOverride || url;
    
    let isMaster = false;
    let maxBandwidthUrl = "";
    let maxBandwidth = 0;
    let maxBandwidthRes = null;
    let fallbackRes = null;
    let duration = 0;
    const subPlaylistUrls = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        isMaster = true;
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
        const res = resMatch ? resMatch[1] : null;
        if (res) fallbackRes = res;
        
        const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        
        const nextLine = lines.slice(i + 1).map(l => l.trim()).find(l => l && !l.startsWith("#"));
        if (nextLine) {
          const absUrl = makeAbsoluteUrl(nextLine, effectiveBase);
          subPlaylistUrls.push(absUrl);
          if (bw >= maxBandwidth) {
            maxBandwidth = bw;
            maxBandwidthUrl = absUrl;
            if (res) maxBandwidthRes = res;
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
          resolution: maxBandwidthRes || fallbackRes || subRes.resolution,
          duration: subRes.duration,
          size: (subRes.duration && maxBandwidth > 0) ? (subRes.duration * maxBandwidth / 8) : null,
          subPlaylistUrls
        };
      }
      return {
        resolution: maxBandwidthRes || fallbackRes,
        duration: null,
        size: null,
        subPlaylistUrls
      };
    }
    
    return {
      resolution: maxBandwidthRes || fallbackRes,
      duration: duration > 0 ? duration : null,
      size: (duration > 0 && maxBandwidth > 0) ? (duration * maxBandwidth / 8) : null,
      subPlaylistUrls
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
  const stem = name
    .split(/[?#]/)[0]
    .replace(/\.(m3u8?|mp4|webm|og[gv]|mov|mkv|ts|m4v|m4s|mp2t|dat|bin)$/i, "")
    .replace(/[_.-]\d{3,7}$/, "");
  return (stem.replace(/[\/\\?%*:|"<>\x00-\x1f]/g, "_").trim().slice(0, 180) || "video") + ".mp4";
}
function makeAbsoluteUrl(path, base) { return new URL(path, base).href; }
chrome.downloads.onChanged.addListener(delta => {
  if (activeDownload?.downloadId !== delta.id || !delta.state) return;
  chrome.runtime.sendMessage({ action: "offscreenSaveState", state: delta.state.current,
    error: delta.error?.current }).catch(() => {});
});
