// content.js
// 커서 위치에서 "맨 위 요소"가 아니라 "하층 요소들"까지 훑어서 이미지 후보를 찾는다.
// - <img> (currentSrc/src)
// - CSS background-image: url(...)
// - <picture>도 결국 <img>로 잡힘

let lastImageHit = null;

function parseCssUrl(bgValue) {
  // background-image: url("..."), url('...'), url(...)
  if (!bgValue || bgValue === "none") return null;
  const m = bgValue.match(/url\((['"]?)(.*?)\1\)/i);
  return m ? m[2] : null;
}

function pickBestImageFromElements(elements) {
  for (const el of elements) {
    if (!el) continue;

    // 1) IMG
    if (el.tagName === "IMG") {
      const url = el.currentSrc || el.src;
      if (url) return { url, kind: "img" };
    }

    // 2) SVG <image> (선택적으로)
    // <image href="..."> 또는 xlink:href
    if (el.tagName === "IMAGE" && el.ownerSVGElement) {
      const href = el.getAttribute("href") || el.getAttribute("xlink:href");
      if (href) return { url: href, kind: "svg-image" };
    }

    // 3) CSS background-image
    const style = window.getComputedStyle(el);
    const bg = style && style.backgroundImage;
    const bgUrl = parseCssUrl(bg);
    if (bgUrl) return { url: bgUrl, kind: "background" };
  }
  return null;
}

function sanitizeFilenamePart(s) {
  return (s || "image")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function guessBaseNameFromUrl(url) {
  try {
    const u = new URL(url, location.href);
    const path = u.pathname.split("/").filter(Boolean).pop() || "image";
    const noQuery = path.split("?")[0].split("#")[0];
    const base = noQuery.replace(/\.[a-z0-9]+$/i, "");
    return sanitizeFilenamePart(base || "image");
  } catch {
    // data: / blob: 등
    return "image";
  }
}

function updateLastHitFromEvent(ev) {
  const x = ev.clientX;
  const y = ev.clientY;

  // 하층까지 포함해서 반환
  const elements = document.elementsFromPoint(x, y);
  const hit = pickBestImageFromElements(elements);

  if (!hit || !hit.url) {
    lastImageHit = null;
    chrome.storage.session?.remove("lastImageHit");
    return;
  }

  const baseName = guessBaseNameFromUrl(hit.url);

  lastImageHit = {
    url: hit.url,
    baseName,
    pageUrl: location.href,
    at: Date.now()
  };

  // service worker에서 context menu click 시 참조하도록 session 저장
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({ lastImageHit });
  } else {
    // session 미지원 환경 대비(거의 없음)
    chrome.storage.local.set({ lastImageHit });
  }
}

// 우클릭 순간의 좌표로 밑 이미지 캡처
window.addEventListener(
  "contextmenu",
  (ev) => {
    try {
      updateLastHitFromEvent(ev);
    } catch {
      // ignore
    }
  },
  { capture: true }
);