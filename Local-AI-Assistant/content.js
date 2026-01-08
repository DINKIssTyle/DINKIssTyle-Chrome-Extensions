/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

// Track selection changes and notify background script
let lastSelectionState = false;

function checkSelectionState() {
    const selection = window.getSelection();
    const hasValidSelection = selection && selection.toString().trim().length > 0;

    if (hasValidSelection !== lastSelectionState) {
        lastSelectionState = hasValidSelection;
        chrome.runtime.sendMessage({
            action: 'selectionChanged',
            hasSelection: hasValidSelection
        }).catch(() => {
            // Ignore errors when background script is not ready
        });
    }
}

// Listen for selection changes
document.addEventListener('selectionchange', checkSelectionState);

// Also check on mouseup for better responsiveness
document.addEventListener('mouseup', () => {
    setTimeout(checkSelectionState, 10);
});

// Check immediately when script loads
checkSelectionState();
