/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

const MENU_ID_TEXT = 'local-ai-process';
const MENU_ID_IMAGE = 'local-ai-vision';
const MENU_ID_ENHANCE = 'local-ai-enhance';

// Get i18n message helper
function i18n(key, fallback = '') {
    return chrome.i18n.getMessage(key) || fallback;
}

// Default settings with i18n support
function getDefaultSettings() {
    return {
        serverAddress: 'localhost:1234',
        modelKey: '',
        maxTokens: 4096,
        temperature: 0.7,
        maxHistory: 10,
        useStreaming: false,
        useVisionMode: false,
        visionPrompt: i18n('defaultVisionPrompt', 'Describe this image in detail.'),
        useTextEnhancement: false,
        textEnhancementPrompt: i18n('defaultEnhancementPrompt', 'Improve the following text to be more clear, professional, and well-structured. Return only the improved text in JSON format with key "enhanced_text":'),
        systemRole: i18n('defaultSystemRole', 'You are an expert at processing web articles, posts, and other content.'),
        userRequest: i18n('defaultUserRequest', 'Summarize the following text:')
    };
}

// Track current selection state for menu creation
let currentHasSelection = false;

async function createContextMenus(includeTextMenu = true) {
    const settings = await chrome.storage.sync.get(getDefaultSettings());

    chrome.contextMenus.removeAll(() => {
        // Create text selection menu only if there's a valid selection
        if (includeTextMenu) {
            chrome.contextMenus.create({
                id: MENU_ID_TEXT,
                title: chrome.i18n.getMessage('contextMenuProcess') || 'Process with Local AI Assistant (LLM)',
                contexts: ['selection']
            });
        }

        // Create image menu if vision mode is enabled
        if (settings.useVisionMode) {
            chrome.contextMenus.create({
                id: MENU_ID_IMAGE,
                title: chrome.i18n.getMessage('contextMenuVision') || 'Analyze Image with Vision AI',
                contexts: ['image']
            });
        }

        // Create text enhancement menu if enabled
        if (settings.useTextEnhancement) {
            chrome.contextMenus.create({
                id: MENU_ID_ENHANCE,
                title: chrome.i18n.getMessage('contextMenuEnhance') || 'Enhance Text with AI',
                contexts: ['editable']
            });
        }
    });
}

chrome.runtime.onInstalled.addListener(() => {
    // Allow content scripts to write to session storage
    if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
        chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    }

    createContextMenus();
});

// Update context menus when settings change
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && (changes.useVisionMode || changes.useTextEnhancement)) {
        createContextMenus();
    }
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'cancelEnhancement') {
        if (globalThis.currentEnhancementAbort) {
            globalThis.currentEnhancementAbort.abort();
            globalThis.currentEnhancementAbort = null;
            console.log('[Local AI Assistant] Enhancement request aborted');
        }
    } else if (message.action === 'selectionChanged') {
        // Recreate menus based on selection state to avoid submenu grouping
        if (currentHasSelection !== message.hasSelection) {
            currentHasSelection = message.hasSelection;
            createContextMenus(message.hasSelection);
        }
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        if (info.menuItemId === MENU_ID_TEXT && info.selectionText && info.selectionText.trim()) {
            await handleTextSelection(info.selectionText);
        } else if (info.menuItemId === MENU_ID_IMAGE && info.srcUrl) {
            await handleImageSelection(info.srcUrl, tab);
        } else if (info.menuItemId === MENU_ID_ENHANCE) {
            await handleTextEnhancement(tab);
        }
    } catch (e) {
        console.error('[Local AI Assistant] Error:', e);
    }
});

async function handleTextSelection(selectedText) {
    await chrome.storage.session.set({
        selectedText: selectedText,
        isNewConversation: true,
        imageData: null
    });

    await openChatWindow();
}

async function handleImageSelection(srcUrl, tab) {
    // Get settings to use custom vision prompt
    const settings = await chrome.storage.sync.get(getDefaultSettings());

    // Convert image to base64
    const imageData = await convertImageToBase64(srcUrl, tab);

    await chrome.storage.session.set({
        selectedText: settings.visionPrompt,
        isNewConversation: true,
        imageData: imageData
    });

    await openChatWindow();
}

// Extract protected content (emo codes, special formats) and replace with placeholders
function extractProtectedContent(text) {
    const protectedItems = [];
    let processedText = text;

    // Protect {emo:...} format
    processedText = processedText.replace(/\{emo:[^}]+\}/g, (match) => {
        const id = protectedItems.length;
        protectedItems.push(match);
        return `[[EMO_${id}]]`;
    });

    // Protect [http...] or [https...] format
    processedText = processedText.replace(/\[https?:\/\/[^\]]+\]/g, (match) => {
        const id = protectedItems.length;
        protectedItems.push(match);
        return `[[URL_BRACKET_${id}]]`;
    });

    // Protect other special formats like {img:...}, {link:...}, etc.
    processedText = processedText.replace(/\{(img|link|video|audio|file):[^}]+\}/g, (match) => {
        const id = protectedItems.length;
        protectedItems.push(match);
        return `[[SPECIAL_${id}]]`;
    });

    return { processedText, protectedItems };
}

// Restore protected content from placeholders
function restoreProtectedContent(enhancedText, protectedItems) {
    let result = enhancedText;
    protectedItems.forEach((original, index) => {
        // Match EMO, URL_BRACKET, and SPECIAL placeholders
        result = result.replace(new RegExp(`\\[\\[(EMO|URL_BRACKET|SPECIAL)_${index}\\]\\]`, 'g'), original);
    });
    return result;
}

// Simple Diff implementation for visualization (LCS based)
// Returns HTML string with highlighted changes
// mode: 'original' (mark deletions) or 'enhanced' (mark insertions)
function computeDiffHtml(original, enhanced, mode = 'original') {
    const O = original;
    const N = enhanced;
    // Limit diff computation for very large texts to avoid freezing
    if (O.length * N.length > 5000000) {
        return escapeHtmlForDiff(mode === 'original' ? O : N); // Too large, fallback to plain text
    }

    const dp = Array(O.length + 1).fill(0).map(() => Array(N.length + 1).fill(0));

    // LCS length calculation
    for (let i = 1; i <= O.length; i++) {
        for (let j = 1; j <= N.length; j++) {
            if (O[i - 1] === N[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find diff
    let i = O.length;
    let j = N.length;
    let stack = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && O[i - 1] === N[j - 1]) {
            // Equal
            stack.push({ type: 'eq', char: O[i - 1] });
            i--; j--;
        } else {
            if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                // Insert (in enhanced)
                stack.push({ type: 'ins', char: N[j - 1] });
                j--;
            } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
                // Delete (from original)
                stack.push({ type: 'del', char: O[i - 1] });
                i--;
            }
        }
    }

    // Process from start (stack pop)
    let currentHtml = '';
    while (stack.length > 0) {
        let op = stack.pop();
        if (op.type === 'eq') {
            currentHtml += escapeHtmlForDiff(op.char);
        } else if (op.type === 'del') {
            if (mode === 'original') {
                // Original view: show deletions
                if (/^\s$/.test(op.char)) {
                    currentHtml += escapeHtmlForDiff(op.char);
                } else {
                    currentHtml += `<s style="color:#ff6b6b;text-decoration-color:#ff6b6b;text-decoration-thickness:2px;opacity:0.8;">${escapeHtmlForDiff(op.char)}</s>`;
                }
            }
            // In enhanced view, deletions are ignored (not shown)
        } else if (op.type === 'ins') {
            if (mode === 'enhanced') {
                // Enhanced view: show insertions
                if (/^\s$/.test(op.char)) {
                    currentHtml += escapeHtmlForDiff(op.char);
                } else {
                    // White text for insertions in enhanced view
                    currentHtml += `<span style="color:#ffffff;font-weight:bold;">${escapeHtmlForDiff(op.char)}</span>`;
                }
            }
            // In original view, insertions are ignored (not shown)
        }
    }
    return currentHtml;
}

function escapeHtmlForDiff(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function handleTextEnhancement(tab) {
    const settings = await chrome.storage.sync.get(getDefaultSettings());

    // Get the text from the active element (editable field) and mark it
    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
                // Mark this element for later reference
                activeElement.dataset.aiEnhanceTarget = 'true';
                if (activeElement.isContentEditable) {
                    return { text: activeElement.innerText, isContentEditable: true };
                } else {
                    return { text: activeElement.value, isContentEditable: false };
                }
            }
            return null;
        }
    });

    const result = results[0]?.result;
    if (!result || !result.text || result.text.trim() === '') {
        console.log('[Local AI Assistant] No text found in editable field');
        return;
    }

    // Extract protected content before sending to AI
    const { processedText, protectedItems } = extractProtectedContent(result.text);

    // Create AbortController for cancellation
    const abortController = new AbortController();

    // Store abort controller globally for message-based cancellation
    globalThis.currentEnhancementAbort = abortController;

    // Show loading indicator with spinner overlay
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (loadingText) => {
            const activeElement = document.activeElement;
            activeElement.dataset.originalText = activeElement.value || activeElement.innerText;

            // Create overlay
            const overlay = document.createElement('div');
            overlay.id = 'ai-enhancement-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 999999;
            `;

            // Create spinner container
            const spinnerContainer = document.createElement('div');
            spinnerContainer.style.cssText = `
                position: relative;
                background: #1e1e1e;
                padding: 24px 32px;
                border-radius: 12px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                min-width: 180px;
            `;

            // Create cancel button
            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'ai-enhancement-cancel';
            cancelBtn.textContent = '✕';
            cancelBtn.style.cssText = `
                position: absolute;
                top: -10px;
                right: -10px;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: #ef4444;
                color: white;
                border: none;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                transition: background 0.2s;
            `;
            cancelBtn.onmouseover = () => cancelBtn.style.background = '#dc2626';
            cancelBtn.onmouseout = () => cancelBtn.style.background = '#ef4444';
            cancelBtn.onclick = () => {
                // Send cancel message to background
                chrome.runtime.sendMessage({ action: 'cancelEnhancement' });
                overlay.remove();
            };

            // Create spinning animation
            const spinnerIcon = document.createElement('div');
            spinnerIcon.style.cssText = `
                width: 32px;
                height: 32px;
                border: 3px solid #444;
                border-top: 3px solid #6366f1;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            `;

            // Add keyframe animation
            const style = document.createElement('style');
            style.id = 'ai-enhancement-style';
            style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
            if (!document.getElementById('ai-enhancement-style')) {
                document.head.appendChild(style);
            }

            // Create text
            const text = document.createElement('div');
            text.textContent = loadingText;
            text.style.cssText = 'color: #fff; font-size: 14px; font-family: sans-serif;';

            spinnerContainer.appendChild(cancelBtn);
            spinnerContainer.appendChild(spinnerIcon);
            spinnerContainer.appendChild(text);
            overlay.appendChild(spinnerContainer);
            document.body.appendChild(overlay);
        },
        args: [chrome.i18n.getMessage('enhancingText') || 'Enhancing text with AI...']
    });

    try {
        // Call LLM for text enhancement with processed text
        const enhancedRaw = await callLLMForEnhancement(processedText, settings, abortController.signal, tab.id, protectedItems.length > 0);

        // Restore protected content
        const enhancedText = restoreProtectedContent(enhancedRaw, protectedItems);

        // Remove loading overlay
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const overlay = document.getElementById('ai-enhancement-overlay');
                if (overlay) overlay.remove();
            }
        });

        // Compute diff HTML for visualizations
        const originalDiffHtml = computeDiffHtml(result.text, enhancedText, 'original');
        const enhancedDiffHtml = computeDiffHtml(result.text, enhancedText, 'enhanced');

        // Show preview modal for user confirmation
        const previewResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (original, enhanced, labels) => {
                return new Promise((resolve) => {
                    // Escape HTML for safe display
                    const escapeHtml = (text) => {
                        const div = document.createElement('div');
                        div.textContent = text;
                        return div.innerHTML;
                    };

                    // Create modal overlay
                    const modal = document.createElement('div');
                    modal.id = 'ai-preview-modal';
                    modal.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.6);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 999999;
                    `;

                    // Create modal content
                    const content = document.createElement('div');
                    content.style.cssText = `
                        background: #1e1e1e;
                        padding: 24px;
                        border-radius: 12px;
                        max-width: 700px;
                        width: 90%;
                        max-height: 80vh;
                        display: flex;
                        flex-direction: column;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    `;

                    // Title
                    const title = document.createElement('h3');
                    title.textContent = labels.title;
                    title.style.cssText = `
                        color: #fff;
                        margin: 0 0 16px 0;
                        font-family: sans-serif;
                        font-size: 18px;
                        font-weight: 600;
                    `;

                    // Scrollable content container
                    const scrollContainer = document.createElement('div');
                    scrollContainer.style.cssText = `
                        flex: 1;
                        overflow-y: auto;
                        margin-bottom: 16px;
                    `;

                    // Original text section
                    const originalLabel = document.createElement('div');
                    originalLabel.textContent = labels.original;
                    originalLabel.style.cssText = 'color: #888; font-size: 13px; margin-bottom: 8px; font-family: sans-serif;';

                    const originalBox = document.createElement('pre');
                    // Use innerHTML directly as original is now safe HTML string with diff tags
                    originalBox.innerHTML = original;
                    originalBox.style.cssText = `
                        background: #2a2a2a;
                        padding: 12px;
                        border-radius: 8px;
                        color: #ccc;
                        font-size: 13px;
                        font-family: inherit;
                        white-space: pre-wrap;
                        word-break: break-word;
                        max-height: 150px;
                        overflow-y: auto;
                        margin: 0 0 16px 0;
                        border: 1px solid #333;
                    `;

                    // Enhanced text section
                    const enhancedLabel = document.createElement('div');
                    enhancedLabel.textContent = labels.enhanced;
                    enhancedLabel.style.cssText = 'color: #888; font-size: 13px; margin-bottom: 8px; font-family: sans-serif;';

                    const enhancedBox = document.createElement('pre');
                    enhancedBox.innerHTML = enhanced; // Already HTML string from diff
                    enhancedBox.style.cssText = `
                        background: #2a2a2a;
                        padding: 12px;
                        border-radius: 8px;
                        color: #ccc;
                        font-size: 13px;
                        font-family: inherit;
                        white-space: pre-wrap;
                        word-break: break-word;
                        max-height: 200px;
                        overflow-y: auto;
                        margin: 0;
                        border: 1px solid #333;
                    `;

                    scrollContainer.appendChild(originalLabel);
                    scrollContainer.appendChild(originalBox);
                    scrollContainer.appendChild(enhancedLabel);
                    scrollContainer.appendChild(enhancedBox);

                    // Button container
                    const buttonContainer = document.createElement('div');
                    buttonContainer.style.cssText = `
                        display: flex;
                        gap: 12px;
                        justify-content: flex-end;
                    `;

                    // Cancel button
                    const cancelBtn = document.createElement('button');
                    cancelBtn.textContent = labels.cancel;
                    cancelBtn.style.cssText = `
                        padding: 10px 24px;
                        background: #444;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        font-family: sans-serif;
                        transition: background 0.2s;
                    `;
                    cancelBtn.onmouseover = () => cancelBtn.style.background = '#555';
                    cancelBtn.onmouseout = () => cancelBtn.style.background = '#444';
                    cancelBtn.onclick = () => {
                        modal.remove();
                        resolve(false);
                    };

                    // Confirm button
                    const confirmBtn = document.createElement('button');
                    confirmBtn.textContent = labels.confirm;
                    confirmBtn.style.cssText = `
                        padding: 10px 24px;
                        background: #6366f1;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        font-family: sans-serif;
                        transition: background 0.2s;
                    `;
                    confirmBtn.onmouseover = () => confirmBtn.style.background = '#5558e3';
                    confirmBtn.onmouseout = () => confirmBtn.style.background = '#6366f1';
                    confirmBtn.onclick = () => {
                        modal.remove();
                        resolve(true);
                    };

                    buttonContainer.appendChild(cancelBtn);
                    buttonContainer.appendChild(confirmBtn);

                    content.appendChild(title);
                    content.appendChild(scrollContainer);
                    content.appendChild(buttonContainer);
                    modal.appendChild(content);
                    document.body.appendChild(modal);

                    // Close on escape key
                    const handleKeydown = (e) => {
                        if (e.key === 'Escape') {
                            modal.remove();
                            document.removeEventListener('keydown', handleKeydown);
                            resolve(false);
                        } else if (e.key === 'Enter') {
                            modal.remove();
                            document.removeEventListener('keydown', handleKeydown);
                            resolve(true);
                        }
                    };
                    document.addEventListener('keydown', handleKeydown);
                });
            },
            args: [originalDiffHtml, enhancedDiffHtml, {
                title: chrome.i18n.getMessage('previewTitle') || 'AI Text Enhancement Preview',
                original: chrome.i18n.getMessage('previewOriginal') || 'Original:',
                enhanced: chrome.i18n.getMessage('previewEnhanced') || 'Enhanced:',
                cancel: chrome.i18n.getMessage('previewCancel') || 'Cancel',
                confirm: chrome.i18n.getMessage('previewConfirm') || 'Apply'
            }]
        });

        const confirmed = previewResults[0]?.result;

        if (confirmed) {
            // Apply the enhanced text to the marked element
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (newText, isContentEditable) => {
                    // Find the marked element
                    const targetElement = document.querySelector('[data-ai-enhance-target="true"]');
                    if (targetElement) {
                        if (isContentEditable) {
                            targetElement.innerText = newText;
                        } else {
                            targetElement.value = newText;
                        }
                        // Trigger input event to ensure frameworks detect the change
                        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                        // Remove the marker
                        delete targetElement.dataset.aiEnhanceTarget;
                    }
                },
                args: [enhancedText, result.isContentEditable]
            });
        } else {
            // User cancelled, remove the marker
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const targetElement = document.querySelector('[data-ai-enhance-target="true"]');
                    if (targetElement) {
                        delete targetElement.dataset.aiEnhanceTarget;
                    }
                }
            });
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[Local AI Assistant] Enhancement aborted');
            return;
        }
        console.error('[Local AI Assistant] Enhancement error:', error);
        // Remove overlay and show error message
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (errorMsg) => {
                const overlay = document.getElementById('ai-enhancement-overlay');
                if (overlay) overlay.remove();
                const modal = document.getElementById('ai-preview-modal');
                if (modal) modal.remove();

                // Show error notification
                const toast = document.createElement('div');
                toast.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #ef4444;
                    color: white;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-family: sans-serif;
                    font-size: 14px;
                    z-index: 999999;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    animation: fadeIn 0.3s ease;
                `;
                toast.textContent = errorMsg;
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 5000);
            },
            args: [chrome.i18n.getMessage('enhancementError') || 'Failed to connect to AI server. Please check if the server is running.']
        });
    }
}

async function callLLMForEnhancement(text, settings, signal = null, tabId = null, hasProtectedContent = false) {
    // Build system message with placeholder preservation instruction if needed
    let systemMessage = 'You are a helpful writing assistant. Always respond with valid JSON containing only the "enhanced_text" key.';
    if (hasProtectedContent) {
        systemMessage += ' CRITICAL: The text contains special placeholders like [[EMO_0]], [[URL_BRACKET_0]], [[SPECIAL_0]], etc. You MUST preserve these placeholders exactly as they appear. Do not modify, remove, translate, or explain them. They must appear in your enhanced_text output exactly as they were in the input.';
    }

    const prompt = `${settings.textEnhancementPrompt}\n\n${text}`;
    console.log('[Local AI Assistant] Starting enhancement request...');

    const fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: settings.modelKey || 'local-model',
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt }
            ],
            max_tokens: settings.maxTokens,
            temperature: settings.temperature,
            stream: false
        })
    };

    // Add signal for abort support
    if (signal) {
        fetchOptions.signal = signal;
    }

    console.log('[Local AI Assistant] Sending fetch to:', `http://${settings.serverAddress}/v1/chat/completions`);
    const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, fetchOptions);
    console.log('[Local AI Assistant] Fetch response received, status:', response.status);

    if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Local AI Assistant] Response data received');
    const content = data.choices?.[0]?.message?.content || '';

    // Try to parse JSON response
    try {
        let jsonStr = content;

        // Handle potential markdown code blocks (```json ... ``` or ``` ... ```)
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        } else {
            // Try to find JSON object pattern in the response
            const jsonObjectMatch = content.match(/\{[\s\S]*"enhanced_text"[\s\S]*\}/);
            if (jsonObjectMatch) {
                jsonStr = jsonObjectMatch[0];
            }
        }

        const parsed = JSON.parse(jsonStr.trim());
        console.log('[Local AI Assistant] JSON parsed successfully');

        if (parsed.enhanced_text) {
            return parsed.enhanced_text;
        }

        // Fallback: return raw content if enhanced_text key not found
        console.log('[Local AI Assistant] enhanced_text key not found in parsed JSON');
        return content;
    } catch (e) {
        console.log('[Local AI Assistant] Could not parse JSON:', e.message);

        // Try regex extraction as last resort
        const textMatch = content.match(/"enhanced_text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            // Unescape JSON string
            const extracted = textMatch[1]
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            console.log('[Local AI Assistant] Extracted enhanced_text via regex');
            return extracted;
        }

        // If all parsing fails, return the raw content
        console.log('[Local AI Assistant] Using raw content as fallback');
        return content;
    }
}

async function convertImageToBase64(srcUrl, tab) {
    try {
        // First, try to fetch directly from background (bypasses CORS)
        const response = await fetch(srcUrl);
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const blob = await response.blob();
        const originalDataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        // If it's already PNG or JPEG, return as-is
        const mimeType = blob.type;
        if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
            return originalDataUrl;
        }

        // For other formats (WebP, etc.), convert to PNG using content script
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (dataUrl) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/png'));
                    };
                    img.onerror = () => resolve(dataUrl); // Return original if conversion fails
                    img.src = dataUrl;
                });
            },
            args: [originalDataUrl]
        });

        return results[0]?.result || originalDataUrl;

    } catch (e) {
        console.error('[Local AI Assistant] Background fetch failed, trying content script:', e);

        // Fallback: try content script method (for same-origin images)
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (imageUrl) => {
                try {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';

                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        img.src = imageUrl;
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    return canvas.toDataURL('image/png');
                } catch (err) {
                    console.error('Content script image conversion failed:', err);
                    return null;
                }
            },
            args: [srcUrl]
        });

        return results[0]?.result || null;
    }
}

async function openChatWindow() {
    const chatUrl = chrome.runtime.getURL('chat.html');
    const width = 500;
    const height = 650;

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
        url: chatUrl,
        type: 'popup',
        width: width,
        height: height,
        left: left,
        top: top
    });
}
