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
            if (tab?.id) {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => alert("Please right-click on an image to use this feature.")
                });
            }
            return;
        }

        // 팝업 창 열기 - 마우스 커서 근처에 열기
        const popupUrl = chrome.runtime.getURL("info.html");
        const popupWidth = 520;
        const popupHeight = 700;

        // 마우스 화면 좌표 사용 (저장된 좌표가 없으면 화면 중앙에 열기)
        let left = hit.screenX || 100;
        let top = hit.screenY || 100;

        // 창이 마우스 오른쪽 아래로 열리도록 약간 오프셋
        left = Math.max(0, left - 50);
        top = Math.max(0, top - 50);

        chrome.windows.create({
            url: popupUrl,
            type: "popup",
            width: popupWidth,
            height: popupHeight,
            left: Math.round(left),
            top: Math.round(top)
        });
    } catch (e) {
        console.error("[Image Information] Error:", e);
    }
});
