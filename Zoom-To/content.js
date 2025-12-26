// Zoom-To: Smart Zoom Extension (Native Browser Zoom Version)
// Double-click on empty space to trigger native browser zoom to fit content container
// Double-click again to restore.

(function () {
    'use strict';

    // Find the best container element
    function findContentContainer(element) {
        // Skip interactive elements
        const interactiveTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'IFRAME'];
        if (interactiveTags.includes(element.tagName)) {
            return null;
        }

        let current = element;
        let bestContainer = null;

        while (current && current !== document.body && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            const rect = current.getBoundingClientRect();

            // Minimal size check
            if (rect.width >= 200 && rect.height >= 100) {
                const display = style.display;
                if (['block', 'flex', 'grid', 'table', 'list-item', 'inline-block'].includes(display)) {
                    bestContainer = current;

                    // Prefer semantic containers or explicit content classes
                    const tag = current.tagName.toLowerCase();
                    const className = (current.className || '').toString().toLowerCase();

                    if (['article', 'main'].includes(tag) ||
                        className.includes('content') ||
                        className.includes('post') ||
                        className.includes('article') ||
                        className.includes('wrapper') ||
                        className.includes('container') ||
                        current.getAttribute('role') === 'main' ||
                        current.getAttribute('role') === 'article') {
                        return current;
                    }
                }
            }
            current = current.parentElement;
        }

        return bestContainer || document.body;
    }

    // Double-click handler
    function handleDblClick(event) {
        // Clear text selection
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
        }

        // Check ignore list
        const interactiveTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'IFRAME', 'IMG'];
        if (interactiveTags.includes(event.target.tagName)) {
            return;
        }

        const container = findContentContainer(event.target);
        if (!container) return;

        console.log("[Zoom-To] Target container:", container);

        // Capture state for ratio logic
        const clickClientX = event.clientX;
        const clickClientY = event.clientY;
        const containerRect = container.getBoundingClientRect(); // Capture PRE-ZOOM/PRE-RESTORE rect

        // Calculate scroll ratio (center of viewport relative to document height)
        // This is used for "Zoom Out -> Keep Position" logic
        const docHeight = document.documentElement.scrollHeight;
        const viewportHeight = document.documentElement.clientHeight;
        const currentScrollY = window.scrollY;
        const centerRatioY = (currentScrollY + (viewportHeight / 2)) / docHeight;

        // Ask background for current zoom to calculate target
        chrome.runtime.sendMessage({ type: 'GET_ZOOM' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Zoom-To] Error getting zoom:", chrome.runtime.lastError);
                return;
            }

            const currentZoom = response.zoomFactor || 1.0;

            // Available width (exclude scrollbar/padding)
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            const availableWidth = viewportWidth - 20;

            // Calculate ratio needed relative to current state
            const widthRatio = availableWidth / containerRect.width;

            // Absolute target zoom
            let targetZoom = currentZoom * widthRatio;

            // Clamp min/max limits
            targetZoom = Math.max(0.25, Math.min(5.0, targetZoom));

            console.log(`[Zoom-To] Current: ${currentZoom}, Ratio: ${widthRatio}, Target: ${targetZoom}`);

            chrome.runtime.sendMessage({
                type: 'TOGGLE_ZOOM',
                targetRatio: targetZoom
            }, (res) => {
                if (chrome.runtime.lastError) {
                    console.error("[Zoom-To] Error setting zoom:", chrome.runtime.lastError);
                    return;
                }

                if (res && res.status === 'zoomed') {
                    // Zoom In Case: scroll clicked point to center
                    requestAnimationFrame(() => {
                        const newRect = container.getBoundingClientRect();

                        // Align container left with padding
                        const targetScrollX = window.scrollX + newRect.left - 10;

                        // Align Y to center the clicked point
                        const relativeClickY = (clickClientY - containerRect.top) / containerRect.height;
                        const newClickOffsetY = relativeClickY * newRect.height;

                        // newRect.top is relative to viewport, so add scrollY to get absolute
                        const newAbsClickY = window.scrollY + newRect.top + newClickOffsetY;

                        const newViewportHeight = document.documentElement.clientHeight;
                        const targetScrollY = newAbsClickY - (newViewportHeight / 2);

                        // Scroll INSTANTLY
                        window.scrollTo({
                            left: Math.max(0, targetScrollX),
                            top: Math.max(0, targetScrollY),
                            behavior: 'auto'
                        });
                    });

                } else if (res && res.status === 'restored') {
                    // Restored (Zoom Out) Case: Keep relative position
                    requestAnimationFrame(() => {
                        // We want to maintain the center position relative to the document
                        const newDocHeight = document.documentElement.scrollHeight;
                        const newViewportHeight = document.documentElement.clientHeight;

                        // Calculate target scrollY based on previous ratio
                        const targetCenterY = centerRatioY * newDocHeight;
                        const targetScrollY = targetCenterY - (newViewportHeight / 2);

                        // For X axis, native zoom usually keeps it logical, 
                        // but if we were aligned left, we might want to center or keep ratio.
                        // Let's rely on browser's native horizontal handling or just keep current X ratio?
                        // Simple approach: Keep X scroll proportional too if possible, 
                        // or just let browser handle X (usually fine).

                        // Actually, calculating Ratio is better.
                        window.scrollTo({
                            left: window.scrollX, // Keep current X (browser might have adjusted it)
                            top: Math.max(0, targetScrollY),
                            behavior: 'auto'
                        });
                    });
                }
            });
        });

        event.preventDefault();
        event.stopPropagation();
    }

    document.addEventListener('dblclick', handleDblClick, true);
    console.log('[Zoom-To] Native Zoom Handler Loaded');

})();
