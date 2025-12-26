// background.js (MV3 service worker)
// - "Article View" context menu
// - Extract article content and open reader window

const MENU_ID = "article_view";

chrome.runtime.onInstalled.addListener(() => {
    // Allow content scripts to write to session storage
    if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
        chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
    }

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_ID,
            title: "Article View",
            contexts: ["all"]
        });
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID) return;

    try {
        // First, try to inject the content script in case it's not loaded
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            });
        } catch (injectError) {
            // Script may already be injected or page doesn't allow injection
            console.log("[Article View] Script injection skipped:", injectError.message);
        }

        // Small delay to ensure script is ready
        await new Promise(resolve => setTimeout(resolve, 100));

        // Send message to content script to extract article
        const response = await chrome.tabs.sendMessage(tab.id, { action: "extractArticle" });

        if (!response || !response.success) {
            console.log("[Article View] Extraction failed:", response?.error);
            return;
        }

        // Store the extracted content
        await chrome.storage.session.set({ articleData: response });

        // Open reader window centered on screen
        const readerUrl = chrome.runtime.getURL("reader.html");
        const width = 800;
        const height = 900;

        // Get display info to center the window
        const displays = await chrome.system.display.getInfo();
        const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
        const screenWidth = primaryDisplay.workArea.width;
        const screenHeight = primaryDisplay.workArea.height;
        const screenLeft = primaryDisplay.workArea.left;
        const screenTop = primaryDisplay.workArea.top;

        const left = Math.round(screenLeft + (screenWidth - width) / 2);
        const top = Math.round(screenTop + (screenHeight - height) / 2);

        chrome.windows.create({
            url: readerUrl,
            type: "popup",
            width: width,
            height: height,
            left: left,
            top: top
        });
    } catch (e) {
        console.error("[Article View] Error:", e);
    }
});
