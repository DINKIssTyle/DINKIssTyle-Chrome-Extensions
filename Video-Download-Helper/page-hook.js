// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
// Main-world hook to detect HLS (#EXTM3U) manifests fetched via disguised URLs (.dat/.txt/XHR) or Blob URLs

(() => {
  if (window.__vdhPageHookInstalled) return;
  window.__vdhPageHookInstalled = true;

  const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
  const reported = new Set();

  function emitPlaylist(url, text) {
    if (!text || typeof text !== "string") return;
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("#EXTM3U")) return;
    // Only emit playlists that contain stream or segment tags
    if (!trimmed.includes("#EXTINF") && !trimmed.includes("#EXT-X-STREAM-INF")) return;
    const key = `${url || location.href}|${trimmed.length}`;
    if (reported.has(key)) return;
    if (reported.size > 200) reported.clear();
    reported.add(key);
    try {
      window.dispatchEvent(new CustomEvent("__vdh_m3u8__", {
        detail: {
          url: url || location.href,
          manifestText: trimmed,
          baseUrl: location.href
        }
      }));
    } catch {}
  }

  function decodeBufferIfM3u8(buffer) {
    try {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      if (bytes.byteLength < 7 || bytes.byteLength > MAX_MANIFEST_BYTES) return null;
      // Check for "#EXTM3U" (0x23 0x45 0x58 0x54 0x4d 0x33 0x55) after optional whitespace/BOM
      let start = 0;
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
      while (start < 16 && start < bytes.byteLength && (bytes[start] === 0x20 || bytes[start] === 0x09 || bytes[start] === 0x0a || bytes[start] === 0x0d)) {
        start++;
      }
      if (
        bytes[start] === 0x23 &&
        bytes[start + 1] === 0x45 &&
        bytes[start + 2] === 0x58 &&
        bytes[start + 3] === 0x54 &&
        bytes[start + 4] === 0x4d &&
        bytes[start + 5] === 0x33 &&
        bytes[start + 6] === 0x55
      ) {
        return new TextDecoder("utf-8").decode(bytes);
      }
    } catch {}
    return null;
  }

  // 1. Hook window.fetch
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = async function (...args) {
      const response = await origFetch.apply(this, args);
      try {
        const lenHeader = response.headers?.get("content-length");
        const len = lenHeader ? parseInt(lenHeader, 10) : 0;
        if (!len || len <= MAX_MANIFEST_BYTES) {
          const clone = response.clone();
          clone.arrayBuffer().then(buf => {
            const text = decodeBufferIfM3u8(buf);
            if (text) emitPlaylist(response.url || (typeof args[0] === "string" ? args[0] : args[0]?.url), text);
          }).catch(() => {});
        }
      } catch {}
      return response;
    };
  }

  // 2. Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__vdhUrl = typeof url === "string" ? new URL(url, location.href).href : String(url); } catch { this.__vdhUrl = String(url || ""); }
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const resUrl = this.responseURL || this.__vdhUrl || location.href;
        if (!this.responseType || this.responseType === "text") {
          if (typeof this.responseText === "string" && this.responseText.length <= MAX_MANIFEST_BYTES) {
            emitPlaylist(resUrl, this.responseText);
          }
        } else if (this.responseType === "arraybuffer" && this.response instanceof ArrayBuffer) {
          const text = decodeBufferIfM3u8(this.response);
          if (text) emitPlaylist(resUrl, text);
        }
      } catch {}
    });
    return origSend.apply(this, args);
  };

  // 3. Hook URL.createObjectURL for Blob-based HLS manifests
  const origCreateObjectURL = URL.createObjectURL;
  if (typeof origCreateObjectURL === "function") {
    URL.createObjectURL = function (obj) {
      const blobUrl = origCreateObjectURL.apply(this, arguments);
      try {
        if (obj instanceof Blob && obj.size >= 7 && obj.size <= MAX_MANIFEST_BYTES) {
          obj.slice(0, 32).arrayBuffer().then(headBuf => {
            if (decodeBufferIfM3u8(headBuf)) {
              return obj.text().then(fullText => emitPlaylist(blobUrl, fullText));
            }
          }).catch(() => {});
        }
      } catch {}
      return blobUrl;
    };
  }
})();

