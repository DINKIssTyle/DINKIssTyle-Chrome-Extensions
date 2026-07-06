// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
// Content script to scan for video thumbnails and titles

// Send collected metadata to background
function sendMetadata(videoUrl, title, thumbnail, resolution, duration) {
  if (!videoUrl) return;
  
  // Resolve relative URLs to absolute URLs
  const absoluteVideoUrl = resolveUrl(videoUrl);
  const absoluteThumbnailUrl = thumbnail ? resolveUrl(thumbnail) : null;
  const pageTitle = title || document.title || "Web Video";

  chrome.runtime.sendMessage({
    action: "mediaMetadata",
    data: {
      videoUrl: absoluteVideoUrl,
      title: pageTitle,
      thumbnail: absoluteThumbnailUrl,
      pageUrl: window.location.href,
      resolution: resolution || null,
      duration: duration || null
    }
  });
}

// Convert relative path to absolute
function resolveUrl(path) {
  try {
    return new URL(path, window.location.href).href;
  } catch (e) {
    return path;
  }
}

// Extract YouTube Video ID from URL
function getYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Extract standard page Meta Image (fallback)
function getPageMetaImage() {
  let pageMetaImage = null;
  const ogImage = document.querySelector('meta[property="og:image"]');
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  const linkImage = document.querySelector('link[rel="image_src"]');
  
  if (ogImage) pageMetaImage = ogImage.content;
  else if (twitterImage) pageMetaImage = twitterImage.content;
  else if (linkImage) pageMetaImage = linkImage.href;
  return pageMetaImage;
}

// Scan individual video element and send metadata
function scanVideoElement(video) {
  const title = video.getAttribute("title") || video.getAttribute("alt") || document.title;
  let thumbnail = video.getAttribute("poster") || getPageMetaImage();
  const resolution = (video.videoWidth && video.videoHeight) ? `${video.videoWidth}x${video.videoHeight}` : null;
  const duration = (video.duration && !isNaN(video.duration)) ? video.duration : null;

  if (video.src && !video.src.startsWith("blob:")) {
    sendMetadata(video.src, title, thumbnail, resolution, duration);
  }

  const sources = video.querySelectorAll("source");
  sources.forEach((src) => {
    if (src.src) {
      sendMetadata(src.src, title, thumbnail, resolution, duration);
    }
  });
}

// Inspect page DOM
function scanDOM() {
  // 1. YouTube specific scanning
  if (window.location.hostname.includes("youtube.com")) {
    const ytId = getYouTubeId(window.location.href);
    if (ytId) {
      const thumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
      const titleElem = document.querySelector("h1.ytd-watch-metadata, yt-formatted-string.ytd-video-primary-info-renderer");
      const title = titleElem ? titleElem.textContent.trim() : document.title.replace(" - YouTube", "");
      
      const video = document.querySelector("video");
      let resolution = null;
      let duration = null;
      if (video) {
        resolution = (video.videoWidth && video.videoHeight) ? `${video.videoWidth}x${video.videoHeight}` : null;
        duration = (video.duration && !isNaN(video.duration)) ? video.duration : null;
        
        if (!video.dataset.hasMetadataListener) {
          video.dataset.hasMetadataListener = "true";
          video.addEventListener("loadedmetadata", scanDOM);
        }
      }

      sendMetadata(window.location.href, title, thumb, resolution, duration);
      sendMetadata("youtube", title, thumb, resolution, duration);
      return;
    }
  }

  // 2. Scan video tags
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    scanVideoElement(video);

    // Watch for metadata load
    if (!video.dataset.hasMetadataListener) {
      video.dataset.hasMetadataListener = "true";
      video.addEventListener("loadedmetadata", () => {
        scanVideoElement(video);
      });
    }
  });
}

// Periodically scan the page for dynamic video elements
let scanTimeout = null;
function throttledScan() {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanDOM, 1000);
}

// Initial scan
scanDOM();

// Watch for DOM changes (MutationObserver)
const observer = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (let mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      for (let node of mutation.addedNodes) {
        if (node.tagName === "VIDEO" || node.tagName === "SOURCE" || (node.querySelector && node.querySelector("video, source"))) {
          shouldScan = true;
          break;
        }
      }
    }
    if (shouldScan) break;
  }
  
  if (shouldScan) {
    throttledScan();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Re-scan when window is fully loaded
window.addEventListener("load", scanDOM);
