// background.js (MV3 service worker)
// - "이미지 정보 보기" 컨텍스트 메뉴 생성
// - 메뉴 클릭 시 info.html 팝업 창 열기

const MENU_ID = "image_information_view";

chrome.runtime.onInstalled.addListener(() => {
    // Allow content scripts to write to session storage
    if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
        chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
    }

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_ID,
            title: "View Image Information",
            contexts: ["all"]
        });
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID) return;

    try {
        // session storage에서 이미지 정보 확인
        let hit = null;
        if (chrome.storage?.session) {
            const data = await chrome.storage.session.get("lastImageHit");
            hit = data?.lastImageHit || null;
        }
        if (!hit && chrome.storage?.local) {
            const data = await chrome.storage.local.get("lastImageHit");
            hit = data?.lastImageHit || null;
        }

        if (!hit || !hit.url) {
            // 이미지가 없으면 알림
            console.log("[Image Information] No image found under cursor");
            return;
        }

        // 팝업 창 열기
        const popupUrl = chrome.runtime.getURL("info.html");
        chrome.windows.create({
            url: popupUrl,
            type: "popup",
            width: 520,
            height: 700
        });
    } catch (e) {
        console.error("[Image Information] Error:", e);
    }
});
