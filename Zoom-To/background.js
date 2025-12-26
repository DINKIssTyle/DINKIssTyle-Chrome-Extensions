// Created by DINKIssTyle on 2025. Copyright (C) 2025 DINKI'ssTyle. All rights reserved.
// background.js for Zoom-To
// Handles native browser zoom requests from content script

// Store previous zoom levels per tab for accurate toggle
const tabZoomState = new Map();

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
                const state = tabZoomState.get(tabId);

                // Smart Zoom Logic:
                // If we have a saved state and we're currently zoomed, restore to previous.
                // Otherwise, save current zoom and zoom to target.

                if (state && state.isZoomed) {
                    // Restore to previous zoom level
                    await chrome.tabs.setZoom(tabId, state.previousZoom);
                    tabZoomState.set(tabId, { isZoomed: false, previousZoom: null });
                    sendResponse({ status: 'restored' });
                } else {
                    // Save current zoom and zoom to target
                    tabZoomState.set(tabId, { isZoomed: true, previousZoom: currentZoom });
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

// Clean up state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    tabZoomState.delete(tabId);
});

// Clean up state when tab navigates to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        tabZoomState.delete(tabId);
    }
});
