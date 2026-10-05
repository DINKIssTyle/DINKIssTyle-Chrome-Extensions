// Discover media in every frame, including lazy sources and open shadow roots.
const reported = new Map();
const watched = new WeakSet();
const roots = new WeakSet();
let pendingScan;
function discover(raw, source, media, explicitType) {
  let url;
  try { url = new URL(raw, document.baseURI); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol)) return;
  const ext = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const hls = /mpegurl/i.test(explicitType || '') || ['m3u8', 'm3u'].includes(ext);
  const audio = /audio/i.test(explicitType || '') || ['mp3', 'm4a', 'wav', 'oga'].includes(ext) || media?.tagName === 'AUDIO';
  if (!hls && !audio && !['mp4', 'webm', 'ogv', 'mov', 'mkv', 'm4v'].includes(ext) && !/^video\//i.test(explicitType || '') && !media) return;
  const data = { url: url.href, source, type: hls ? 'm3u8' : audio ? 'audio' : 'video',
    extension: hls ? 'm3u8' : ext || (audio ? 'audio' : 'video'),
    title: media?.getAttribute('title') || document.querySelector('meta[property="og:title"]')?.content || document.title || 'Web Video',
    thumbnail: media?.poster || document.querySelector('meta[property="og:image"]')?.content || null,
    resolution: media?.videoWidth ? `${media.videoWidth}x${media.videoHeight}` : null,
    duration: Number.isFinite(media?.duration) && media.duration > 0 ? media.duration : null };
  const signature = JSON.stringify(data);
  if (reported.get(url.href) === signature) return;
  if (reported.size > 1000) reported.clear();
  reported.set(url.href, signature);
  chrome.runtime.sendMessage({ action: 'discoveredMedia', data }).catch(() => {});
}
function scanMedia(media) {
  for (const attr of ['currentSrc', 'src']) if (media[attr]) discover(media[attr], 'media element', media);
  for (const attr of ['data-src', 'data-video-src', 'data-hls', 'data-url']) {
    if (media.getAttribute(attr)) discover(media.getAttribute(attr), 'lazy media', media);
  }
  media.querySelectorAll('source').forEach(node => discover(node.src || node.dataset.src, 'source', media, node.type));
  if (!watched.has(media)) {
    watched.add(media);
    for (const event of ['loadedmetadata', 'durationchange', 'emptied', 'play']) media.addEventListener(event, () => scanMedia(media));
  }
}
function walkJSON(value, depth = 0) {
  if (depth > 12 || !value) return;
  if (typeof value === 'string') discover(value, 'page data');
  else if (Array.isArray(value)) value.slice(0, 1000).forEach(item => walkJSON(item, depth + 1));
  else if (typeof value === 'object') Object.values(value).slice(0, 1000).forEach(item => walkJSON(item, depth + 1));
}
function scan(root = document) {
  if (!roots.has(root)) {
    roots.add(root);
    new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'href', 'content', 'poster', 'data-src', 'data-video-src', 'data-hls', 'data-url'] });
  }
  root.querySelectorAll('video,audio').forEach(scanMedia);
  root.querySelectorAll('a[href],link[href],meta[content],[data-src],[data-video-src],[data-hls],[data-url]').forEach(node => {
    for (const attr of ['href', 'content', 'data-src', 'data-video-src', 'data-hls', 'data-url']) {
      const value = node.getAttribute(attr);
      if (value) discover(value, 'page attribute', null, node.getAttribute('type'));
    }
  });
  root.querySelectorAll('script:not([src])').forEach(script => {
    const text = script.textContent;
    if (!text || text.length > 2_000_000 || reported.get(script) === text) return;
    reported.set(script, text);
    if (/json/i.test(script.type)) { try { walkJSON(JSON.parse(text)); } catch {} }
    const normalized = text.replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
    for (const match of normalized.matchAll(/(?:https?:\/\/|\/)[^\s"'<>\\]+?\.(?:mp4|webm|m3u8|m4v|mov|ogv)(?:\?[^\s"'<>\\]*)?/gi)) {
      discover(match[0], 'player configuration');
    }
  });
  root.querySelectorAll('*').forEach(node => { if (node.shadowRoot) scan(node.shadowRoot); });
}
function scheduleScan() {
  if (pendingScan) return;
  pendingScan = setTimeout(() => { pendingScan = null; scan(); }, 350);
}
scan();
performance.getEntriesByType('resource').forEach(entry => discover(entry.name, 'resource timing'));
try {
  new PerformanceObserver(list => list.getEntries().forEach(entry => discover(entry.name, 'resource timing'))).observe({ type: 'resource', buffered: true });
} catch {}
chrome.runtime.onMessage.addListener(message => { if (message.action === 'rescanMedia') { reported.clear(); scan(); } });
window.addEventListener('load', scheduleScan);
// Also finds shadow roots attached after their hosts were inserted and SPA changes.
setInterval(scheduleScan, 5000);
