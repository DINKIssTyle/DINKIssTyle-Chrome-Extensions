// background.js for Zoom-To
// Handles native browser zoom requests from content script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Return true to indicate async response

    if (request.type === 'GET_ZOOM') {
        const tabId = sender.tab.id;
        chrome.tabs.getZoom(tabId, (zoomFactor) => {
            sendResponse({ zoomFactor: zoomFactor });
        });
        return true;
    }

    if (request.type === 'TOGGLE_ZOOM') {
        const tabId = sender.tab.id;
        const targetRatio = request.targetRatio;

        (async () => {
            try {
                const currentZoom = await chrome.tabs.getZoom(tabId);

                // Smart Zoom Logic:
                // If current zoom is close to target zoom, restore to default (0 means default).
                // Otherwise, set to target zoom.

                const epsilon = 0.1;

                if (Math.abs(currentZoom - targetRatio) < epsilon) {
                    // We are roughly at target -> Restore
                    // Setting zoom to 0 resets to default zoom factor defined in settings
                    await chrome.tabs.setZoom(tabId, 0);
                    sendResponse({ status: 'restored' });
                } else {
                    // Zoom to target
                    await chrome.tabs.setZoom(tabId, targetRatio);
                    sendResponse({ status: 'zoomed' });
                }
            } catch (e) {
                console.error("[Zoom-To] Zoom failed:", e);
                sendResponse({ status: 'error', message: e.message });
            }
        })();

        return true;
    }
});
