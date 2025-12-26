// background.js (MV3 service worker, module)
// - contextMenus: JPG / PNG / WebP / Original
// - lastImageHit (chrome.storage.session)에서 대상 URL을 가져와 처리
// - 변환은 OffscreenCanvas + createImageBitmap

const MENU_ROOT = "save_image_as_type_root";
const MENU_ORIGINAL = "save_original";
const MENU_JPG = "save_jpg";
const MENU_PNG = "save_png";
const MENU_WEBP = "save_webp";

chrome.runtime.onInstalled.addListener(() => {
  // Allow content scripts to write to session storage
  if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ROOT,
      title: "Save image as type",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: MENU_ORIGINAL,
      parentId: MENU_ROOT,
      title: "Save as Original",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: MENU_JPG,
      parentId: MENU_ROOT,
      title: "Save as JPG",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: MENU_PNG,
      parentId: MENU_ROOT,
      title: "Save as PNG",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: MENU_WEBP,
      parentId: MENU_ROOT,
      title: "Save as WebP",
      contexts: ["all"]
    });
  });
});

function buildFilename(baseName, ext) {
  const safe = (baseName || "image").replace(/[\\/:*?"<>|]+/g, "_").trim();
  return `${safe}.${ext}`;
}

async function getLastHit() {
  let hit = null;

  // 1. Session storage (priority)
  if (chrome.storage?.session) {
    const data = await chrome.storage.session.get("lastImageHit");
    hit = data?.lastImageHit || null;
  }

  // 2. Fallback to local storage if session missed
  if (!hit && chrome.storage?.local) {
    const data = await chrome.storage.local.get("lastImageHit");
    hit = data?.lastImageHit || null;
  }

  return hit;
}

async function fetchAsBlob(url) {
  // data:, blob:, http(s) 모두 대응(가능 범위 내)
  // ※ CORS/인증이 걸린 리소스는 실패할 수 있음
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return await res.blob();
}

async function convertBlobToType(inputBlob, mime, quality = 0.92) {
  // createImageBitmap은 대부분의 이미지 형식을 지원하지만,
  // 일부(webp/avif 등) 환경 차이가 있을 수 있음
  const bitmap = await createImageBitmap(inputBlob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.drawImage(bitmap, 0, 0);

  // JPG는 알파 지원 안하므로 배경 흰색을 깔고 싶으면 아래 주석 해제
  // if (mime === "image/jpeg") {
  //   const tmp = new OffscreenCanvas(bitmap.width, bitmap.height);
  //   const tctx = tmp.getContext("2d");
  //   tctx.fillStyle = "#fff";
  //   tctx.fillRect(0, 0, bitmap.width, bitmap.height);
  //   tctx.drawImage(canvas, 0, 0);
  //   return await tmp.convertToBlob({ type: mime, quality });
  // }

  return await canvas.convertToBlob({ type: mime, quality });
}

// Service Worker에서는 URL.createObjectURL을 사용할 수 없으므로
// Blob을 Data URL로 변환하여 다운로드
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downloadBlob(blob, filename) {
  const dataUrl = await blobToDataURL(blob);
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true
  });
}

async function downloadOriginal(url, baseName) {
  // 원본은 브라우저 다운로드로 바로 시도
  // 파일명이 서버에서 내려주는 경우도 있으니 filename 생략 가능.
  // saveAs는 사용자가 선택하게.
  await chrome.downloads.download({
    url,
    filename: buildFilename(baseName, "original"),
    saveAs: true
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const hit = await getLastHit();
    if (!hit?.url) {
      // Show alert when no image is detected
      if (tab?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => alert("Please right-click on an image to use this feature.")
        });
      }
      return;
    }

    const targetUrl = hit.url;
    const baseName = hit.baseName || "image";

    if (info.menuItemId === MENU_ORIGINAL) {
      // 원본 저장(가장 단순)
      await chrome.downloads.download({
        url: targetUrl,
        saveAs: true
      });
      return;
    }

    // 변환 저장
    const inputBlob = await fetchAsBlob(targetUrl);

    if (info.menuItemId === MENU_JPG) {
      const out = await convertBlobToType(inputBlob, "image/jpeg", 0.92);
      await downloadBlob(out, buildFilename(baseName, "jpg"));
      return;
    }
    if (info.menuItemId === MENU_PNG) {
      const out = await convertBlobToType(inputBlob, "image/png");
      await downloadBlob(out, buildFilename(baseName, "png"));
      return;
    }
    if (info.menuItemId === MENU_WEBP) {
      const out = await convertBlobToType(inputBlob, "image/webp", 0.92);
      await downloadBlob(out, buildFilename(baseName, "webp"));
      return;
    }
  } catch (e) {
    // 조용히 실패하지 말고 콘솔에 원인 남김
    console.error("[Save image as type] failed:", e);
  }
});