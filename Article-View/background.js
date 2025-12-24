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

        // Open reader window
        const readerUrl = chrome.runtime.getURL("reader.html");
        chrome.windows.create({
            url: readerUrl,
            type: "popup",
            width: 800,
            height: 900
        });
    } catch (e) {
        console.error("[Article View] Error:", e);
    }
});
