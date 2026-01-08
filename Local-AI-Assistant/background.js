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

async function createContextMenus() {
    const settings = await chrome.storage.sync.get(getDefaultSettings());

    chrome.contextMenus.removeAll(() => {
        // Always create text selection menu
        chrome.contextMenus.create({
            id: MENU_ID_TEXT,
            title: chrome.i18n.getMessage('contextMenuProcess') || 'Process with Local AI Assistant (LLM)',
            contexts: ['selection']
        });

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

// Listen for cancel enhancement message
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'cancelEnhancement') {
        if (globalThis.currentEnhancementAbort) {
            globalThis.currentEnhancementAbort.abort();
            globalThis.currentEnhancementAbort = null;
            console.log('[Local AI Assistant] Enhancement request aborted');
        }
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        if (info.menuItemId === MENU_ID_TEXT && info.selectionText) {
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

async function handleTextEnhancement(tab) {
    const settings = await chrome.storage.sync.get(getDefaultSettings());

    // Get the text from the active element (editable field)
    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
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
        // Call LLM for text enhancement
        const enhancedText = await callLLMForEnhancement(result.text, settings, abortController.signal, tab.id);

        // Check if cancelled
        const cancelCheck = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.aiEnhancementCancelled
        });

        if (cancelCheck[0]?.result) {
            console.log('[Local AI Assistant] Enhancement cancelled by user');
            return;
        }

        // Replace the text in the editable field and remove overlay
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (newText, isContentEditable) => {
                // Remove overlay
                const overlay = document.getElementById('ai-enhancement-overlay');
                if (overlay) overlay.remove();

                const activeElement = document.activeElement;
                if (isContentEditable) {
                    activeElement.innerText = newText;
                } else {
                    activeElement.value = newText;
                }
                // Trigger input event to ensure frameworks detect the change
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            },
            args: [enhancedText, result.isContentEditable]
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[Local AI Assistant] Enhancement aborted');
            return;
        }
        console.error('[Local AI Assistant] Enhancement error:', error);
        // Remove overlay on error
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const overlay = document.getElementById('ai-enhancement-overlay');
                if (overlay) overlay.remove();
            }
        });
    }
}

async function callLLMForEnhancement(text, settings, signal = null, tabId = null) {
    const prompt = `${settings.textEnhancementPrompt}\n\n${text}`;

    const fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: settings.modelKey || 'local-model',
            messages: [
                { role: 'system', content: 'You are a helpful writing assistant. Always respond with valid JSON.' },
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

    const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, fetchOptions);

    if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Try to parse JSON response
    try {
        // Handle potential markdown code blocks
        let jsonStr = content;
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        const parsed = JSON.parse(jsonStr.trim());
        return parsed.enhanced_text || content;
    } catch (e) {
        // If JSON parsing fails, return the raw content
        console.log('[Local AI Assistant] Could not parse JSON, using raw content');
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
