// background.js - Service worker for Visual Effects extension

// Default settings
const DEFAULT_SETTINGS = {
    enabled: true,
    effect: 'slide', // slide, fade, curl, flip, zoom
    duration: 400,
    direction: 'left' // left, right, up, down
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
    const existing = await chrome.storage.sync.get('visualEffects');
    if (!existing.visualEffects) {
        await chrome.storage.sync.set({ visualEffects: DEFAULT_SETTINGS });
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getSettings') {
        chrome.storage.sync.get('visualEffects').then(result => {
            sendResponse(result.visualEffects || DEFAULT_SETTINGS);
        });
        return true; // Keep channel open for async response
    }
});
