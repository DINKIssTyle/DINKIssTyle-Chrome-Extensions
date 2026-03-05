/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

document.addEventListener('DOMContentLoaded', () => {
    // Apply i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            el.textContent = message;
        }
    });

    const btnClearCache = document.getElementById('btnClearCache');

    btnClearCache.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id || tab.url.startsWith('chrome://')) {
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: clearTabCacheAndReload,
            args: [
                chrome.i18n.getMessage('clearCacheSuccess'),
                chrome.i18n.getMessage('reloading')
            ]
        });
    });
});

/**
 * Function injected into the active tab to clear cache and reload
 */
async function clearTabCacheAndReload(successMsg, reloadMsg) {
    try {
        console.log('PowerCache-Cleaner: Starting cleanup...');

        // 1. Clear Cache Storage
        if ('caches' in window) {
            const keys = await caches.keys();
            for (const key of keys) {
                await caches.delete(key);
                console.log(`PowerCache-Cleaner: Deleted cache key: ${key}`);
            }
        }

        // 2. Unregister Service Workers
        if ('navigator' in window && 'serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
                console.log('PowerCache-Cleaner: Unregistered Service Worker');
            }
        }

        // 3. Clear Session Storage (Optional but powerful)
        // sessionStorage.clear();

        console.log('PowerCache-Cleaner: Cleanup complete.');

        // 4. Notify user and reload
        alert(`${successMsg}\n\n${reloadMsg}`);

        // Reload bypassing cache (deprecated but still works in many environments)
        // or just standard reload which usually respects SW unregistration
        location.reload();

    } catch (error) {
        console.error('PowerCache-Cleaner: Error clearing cache', error);
        alert('Error clearing cache.');
    }
}
