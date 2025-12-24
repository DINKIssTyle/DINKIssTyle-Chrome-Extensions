// content.js - Article extraction logic
// Uses heuristics to find the main content area and extract clean HTML

(function () {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "extractArticle") {
            const result = extractArticle();
            sendResponse(result);
        }
        return true;
    });

    function extractArticle() {
        // Try to find the main content using common selectors
        // More specific selectors first, generic ones later
        const selectors = [
            // Korean news sites
            '.article_view', '.news_view', '.article_body', '.news_body',
            '#articleBody', '#newsBody', '.article_txt', '.news_txt',
            '#harmonyContainer', '.content_article', '.view_content',
            // Daum/Kakao specific
            '[data-cloud-area="article"]', '.article_cont',
            // Generic article selectors
            'article', '[role="article"]',
            '.post-content', '.article-content', '.entry-content',
            '.content-body', '.story-body', '#article-body',
            '.post-body', '.blog-post', '.hentry',
            // Fallback
            '[role="main"]', 'main'
        ];

        let contentElement = null;

        // Try each selector
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.length > 200) {
                contentElement = el;
                break;
            }
        }

        // Fallback: find the element with the most paragraph content
        if (!contentElement) {
            contentElement = findLargestContentBlock();
        }

        if (!contentElement) {
            return { success: false, error: "Could not find article content" };
        }

        // Extract title
        const title = extractTitle();

        // Clean and extract content
        const cleanedContent = cleanContent(contentElement.cloneNode(true));

        return {
            success: true,
            title: title,
            content: cleanedContent.innerHTML,
            url: window.location.href,
            siteName: extractSiteName()
        };
    }

    function extractTitle() {
        // Try Open Graph title first
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) return ogTitle.content;

        // Try article heading
        const h1 = document.querySelector('article h1, .article_view h1, main h1, h1');
        if (h1) return h1.textContent.trim();

        // Fallback to document title
        return document.title.split('|')[0].split('-')[0].trim();
    }

    function extractSiteName() {
        const ogSite = document.querySelector('meta[property="og:site_name"]');
        if (ogSite) return ogSite.content;
        return window.location.hostname;
    }

    function findLargestContentBlock() {
        const candidates = document.querySelectorAll('div, section');
        let best = null;
        let bestScore = 0;

        for (const el of candidates) {
            // Skip navigation, footer, sidebar, etc.
            const className = (el.className || '').toLowerCase();
            const id = (el.id || '').toLowerCase();
            if (/nav|menu|sidebar|footer|header|comment|ad|banner|social|share|related|tts|voice|translate|aside/i.test(className + id)) {
                continue;
            }

            const text = el.innerText || '';
            const pCount = el.querySelectorAll('p').length;
            const score = text.length + (pCount * 100);

            if (score > bestScore && text.length > 500) {
                bestScore = score;
                best = el;
            }
        }

        return best;
    }

    function cleanContent(element) {
        // Extensive list of selectors to remove
        const removeSelectors = [
            // Core unwanted elements
            'script', 'style', 'noscript', 'iframe', 'form', 'button', 'input',
            'select', 'textarea', 'label', 'svg', 'canvas', 'video', 'audio',

            // Ads and promotions
            '.ad', '.ads', '.advertisement', '.advert', '[class*="ad-"]', '[class*="ads-"]',
            '[id*="ad-"]', '[id*="ads-"]', '.banner', '.promo', '.promotion',

            // Social and sharing
            '.social', '.social-share', '.share', '.sharing', '.sns', '.sns_share',
            '[class*="social"]', '[class*="share"]',

            // Comments
            '.comment', '.comments', '.reply', '.replies', '[class*="comment"]',

            // Navigation and menus
            '.nav', '.navigation', '.menu', '.breadcrumb', '.pagination',
            '[role="navigation"]', '[role="menu"]',

            // Header and footer areas
            '.header', '.footer', '.sidebar', '.aside',
            '[role="complementary"]', '[role="banner"]', '[role="contentinfo"]',

            // Related and recommendations
            '.related', '.recommend', '.recommendation', '.more', '.also',
            '[class*="related"]', '[class*="recommend"]',

            // Newsletter and subscription
            '.newsletter', '.subscription', '.subscribe', '.signup',

            // TTS / Voice / Translation controls (Korean news sites)
            '.tts', '.voice', '.reader', '[class*="tts"]', '[class*="voice"]',
            '[class*="reader_"]', '.typetak', '[class*="typetak"]',
            '.translate', '.translation', '[class*="translate"]',
            '.player', '.audio_player', '[class*="player"]',

            // Daum/Kakao specific
            '.txt_info', '.info_view', '.util_view', '.tool_info',
            '.btn_area', '.bundle_tts', '.layer_tts', '.tit_tts',
            '[class*="layer_"]', '[class*="bundle_"]', '[class*="util_"]',
            '.copyright', '.source', '.reporter', '.byline',
            '.tag', '.tags', '.keyword', '.keywords',
            '[class*="tag_"]', '[class*="keyword"]',

            // Naver specific
            '.media_end_head', '.go_trans', '.u_likeit', '_article_like',

            // Common UI elements
            '.btn', '.button', '[class*="btn_"]', '[class*="button"]',
            '.icon', '[class*="icon"]', '.tooltip', '.popup', '.modal',
            '.close', '.toggle', '.expand', '.collapse',

            // Figure captions that are too long (likely UI)
            'figcaption'
        ];

        // Remove by selectors
        for (const selector of removeSelectors) {
            try {
                const elements = element.querySelectorAll(selector);
                elements.forEach(el => el.remove());
            } catch (e) {
                // Invalid selector, skip
            }
        }

        // Remove elements with specific text patterns (TTS, voice controls, etc.)
        const textPatternsToRemove = [
            /음성으로\s*듣기/,
            /음성\s*재생/,
            /음성\s*설정/,
            /타입독/,
            /번역\s*설정/,
            /translated\s*by/i,
            /기사\s*입력/,
            /기자$/,
            /무단\s*전재/,
            /저작권/,
            /copyright/i,
            /all\s*rights\s*reserved/i
        ];

        const allElements = element.querySelectorAll('*');
        allElements.forEach(el => {
            // Skip if already removed or is important content element
            if (!el.parentNode) return;
            if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'IMG'].includes(el.tagName)) {
                // Only remove if the entire content matches a pattern
                const text = el.textContent.trim();
                if (text.length < 100) {
                    for (const pattern of textPatternsToRemove) {
                        if (pattern.test(text)) {
                            el.remove();
                            return;
                        }
                    }
                }
                return;
            }

            // For other elements, check if they contain only UI text
            const text = el.textContent.trim();
            if (text.length < 50) {
                for (const pattern of textPatternsToRemove) {
                    if (pattern.test(text)) {
                        el.remove();
                        return;
                    }
                }
            }
        });

        // Remove hidden elements
        const remainingElements = element.querySelectorAll('*');
        remainingElements.forEach(el => {
            if (!el.parentNode) return;
            try {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    el.remove();
                }
            } catch (e) {
                // Element may have been removed
            }
        });

        // Remove list items that look like radio/checkbox options
        const listItems = element.querySelectorAll('li');
        listItems.forEach(li => {
            const text = li.textContent.trim();
            // Short list items with radio-button-like content
            if (text.length < 20 && /^[○●◯◉]?\s*(남성|여성|느림|보통|빠름|male|female|slow|normal|fast)$/i.test(text)) {
                li.remove();
            }
        });

        // Remove empty elements
        const cleanEmpty = () => {
            const empties = element.querySelectorAll('div, span, ul, ol, p');
            empties.forEach(el => {
                if (!el.parentNode) return;
                const text = el.textContent.trim();
                const hasImg = el.querySelector('img');
                if (!text && !hasImg) {
                    el.remove();
                }
            });
        };
        cleanEmpty();
        cleanEmpty(); // Run twice to catch nested empties

        // Clean up remaining elements - remove classes/ids but keep structure
        const finalElements = element.querySelectorAll('*');
        finalElements.forEach(el => {
            if (el.tagName !== 'IMG' && el.tagName !== 'A') {
                el.removeAttribute('style');
            }
            el.removeAttribute('class');
            el.removeAttribute('id');
            el.removeAttribute('data-reactid');
            el.removeAttribute('data-reactroot');
            // Remove all data-* attributes
            [...el.attributes].forEach(attr => {
                if (attr.name.startsWith('data-')) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        return element;
    }
})();
