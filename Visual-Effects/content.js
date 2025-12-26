// content.js - Visual Effects page transition handler
// Supports link clicks and back/forward navigation with direction reversal

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__visualEffectsLoaded) return;
    window.__visualEffectsLoaded = true;

    let settings = {
        enabled: true,
        effect: 'slide',
        duration: 400,
        direction: 'left'
    };

    // Track history index for back/forward detection
    const HISTORY_KEY = 've-history-index';
    let currentHistoryIndex = parseInt(sessionStorage.getItem(HISTORY_KEY) || '0');

    // Initialize history tracking
    function initHistoryTracking() {
        // On first load, set initial index
        if (!sessionStorage.getItem(HISTORY_KEY)) {
            currentHistoryIndex = history.length;
            sessionStorage.setItem(HISTORY_KEY, currentHistoryIndex.toString());
        }
    }

    // Load settings
    async function loadSettings() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
            if (response) {
                settings = response;
            }
        } catch (e) {
            console.log('[Visual Effects] Using default settings');
        }
    }

    // Initialize
    loadSettings();
    initHistoryTracking();

    // Listen for setting changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.visualEffects) {
            settings = changes.visualEffects.newValue;
        }
    });

    // Get opposite direction
    function getOppositeDirection(direction) {
        const opposites = {
            left: 'right',
            right: 'left',
            up: 'down',
            down: 'up'
        };
        return opposites[direction] || direction;
    }

    // Get animation class based on effect and direction
    function getAnimationClass(direction) {
        const effect = settings.effect;

        switch (effect) {
            case 'slide':
                return `ve-slide-out-${direction}`;
            case 'fade':
                return 've-fade-out';
            case 'flip':
                return 've-flip-out';
            case 'zoom':
                return 've-zoom-out';
            case 'curl':
                return direction === 'left' || direction === 'up' ? 've-curl-out' : 've-curl-out-reverse';
            default:
                return 've-fade-out';
        }
    }

    // Play exit animation on the current page body
    function playExitAnimation(isReverse = false) {
        if (!settings.enabled) return Promise.resolve();

        const direction = isReverse ? getOppositeDirection(settings.direction) : settings.direction;
        const bodyAnimation = getAnimationClass(direction);
        const duration = settings.duration;

        // Add animation to the body
        document.body.style.overflow = 'hidden';
        document.body.style.animation = `${bodyAnimation} ${duration}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`;

        // Add curl shadow for curl effect
        if (settings.effect === 'curl') {
            const shadow = document.createElement('div');
            shadow.className = 've-curl-shadow';
            shadow.style.position = 'fixed';
            shadow.style.top = '0';
            shadow.style.left = '0';
            shadow.style.width = '100vw';
            shadow.style.height = '100vh';
            shadow.style.zIndex = '2147483646';
            shadow.style.pointerEvents = 'none';
            shadow.style.animation = `ve-fade-in ${duration}ms forwards`;
            document.body.appendChild(shadow);
        }

        return new Promise(resolve => {
            setTimeout(resolve, duration * 0.8);
        });
    }

    // Handle link clicks (forward navigation)
    function handleLinkClick(event) {
        if (!settings.enabled) return;

        // Find the actual link element
        let target = event.target;
        while (target && target.tagName !== 'A') {
            target = target.parentElement;
        }

        if (!target || !target.href) return;

        // Skip special links
        const href = target.href;
        if (href.startsWith('javascript:') ||
            href.startsWith('#') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            target.target === '_blank' ||
            event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }

        // Skip same-page anchors
        const currentUrl = new URL(window.location.href);
        const targetUrl = new URL(href, window.location.href);

        if (currentUrl.origin === targetUrl.origin &&
            currentUrl.pathname === targetUrl.pathname &&
            targetUrl.hash) {
            return;
        }

        // Prevent default navigation
        event.preventDefault();
        event.stopPropagation();

        // Update history index for forward navigation
        currentHistoryIndex++;
        sessionStorage.setItem(HISTORY_KEY, currentHistoryIndex.toString());

        // Play exit animation (normal direction) then navigate
        playExitAnimation(false).then(() => {
            window.location.href = href;
        });
    }

    // Handle back/forward navigation
    let isNavigatingBack = false;

    // Detect back/forward before it happens using beforeunload + popstate
    window.addEventListener('popstate', (event) => {
        if (!settings.enabled) return;

        // Determine direction by comparing history index
        const newIndex = history.length;
        const storedIndex = parseInt(sessionStorage.getItem(HISTORY_KEY) || '0');

        // This is a heuristic - popstate fires after navigation starts
        // We use pageshow for the actual animation
    });

    // Use pageshow to handle back/forward (especially from bfcache)
    window.addEventListener('pageshow', (event) => {
        if (!settings.enabled) return;

        // Check if coming from bfcache (back/forward)
        if (event.persisted) {
            // Page was restored from cache - apply reverse animation
            const storedIndex = parseInt(sessionStorage.getItem(HISTORY_KEY) || '0');
            const newIndex = history.length;

            // Determine if going back or forward
            const isBack = newIndex <= storedIndex;

            // Update stored index
            sessionStorage.setItem(HISTORY_KEY, newIndex.toString());

            // Apply entrance animation with reverse direction
            const direction = isBack ? getOppositeDirection(settings.direction) : settings.direction;
            const effect = settings.effect;
            let animationClass = '';

            switch (effect) {
                case 'slide':
                    animationClass = `ve-slide-in-${direction}`;
                    break;
                case 'fade':
                    animationClass = 've-fade-in';
                    break;
                case 'flip':
                    animationClass = 've-flip-in';
                    break;
                case 'zoom':
                    animationClass = 've-zoom-in';
                    break;
                case 'curl':
                    animationClass = 've-curl-in';
                    break;
                default:
                    animationClass = 've-fade-in';
            }

            document.body.style.animation = `${animationClass} ${settings.duration}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`;

            setTimeout(() => {
                document.body.style.animation = '';
            }, settings.duration);
        }
    });

    // Intercept back button using beforeunload for animation
    // This provides visual feedback before navigation
    let navigationPending = false;

    window.addEventListener('beforeunload', (event) => {
        // Note: We can't prevent navigation here, just show our animation
        // The animation will play briefly before the browser navigates
    });

    // Set up event listeners when DOM is ready
    function init() {
        document.addEventListener('click', handleLinkClick, true);
    }

    // Wait for document to be available
    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
