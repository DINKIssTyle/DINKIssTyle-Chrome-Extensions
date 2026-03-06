/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

// Get i18n message helper
function i18n(key, fallback = '') {
    return (window.ci18n ? window.ci18n.getMessage(key) : chrome.i18n.getMessage(key)) || fallback;
}

// Apply i18n translations
function applyI18n() {
    if (window.ci18n) {
        window.ci18n.applyToDOM();
    } else {
        // Fallback text content translations
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const message = chrome.i18n.getMessage(key);
            if (message) {
                element.textContent = message;
            }
        });

        // Fallback placeholder translations
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const message = chrome.i18n.getMessage(key);
            if (message) {
                element.placeholder = message;
            }
        });

        // Fallback title translations
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const message = chrome.i18n.getMessage(key);
            if (message) {
                element.title = message;
            }
        });
    }
}

// Default settings with i18n support
function getDefaultSettings() {
    return {
        serverAddress: 'localhost:1234',
        apiKey: '',
        modelKey: '',
        maxTokens: 4096,
        temperature: 0.7,
        maxHistory: 10,
        useStreaming: false,
        useThinking: false,
        llmMode: 'openai',
        mcpServerLabel: '',
        useVisionMode: false,
        useSidePanel: false,
        showSummarizeBtn: true,
        visionPrompt: i18n('defaultVisionPrompt', 'Describe this image in detail.'),
        useTextEnhancement: false,
        textEnhancementPrompt: i18n('defaultEnhancementPrompt', 'Improve the following text to be more clear, professional, and well-structured. Return only the improved text in JSON format with key "enhanced_text":'),
        systemRole: i18n('defaultSystemRole', 'You are an expert at processing web articles, posts, and other content.'),
        userRequest: i18n('defaultUserRequest', 'Summarize the following text:'),
        summarizePrompt: i18n('defaultSummarizePrompt', 'Summarize the following webpage content:')
    };
}

let conversationHistory = [];
let settings = {};
let lastAssistantResponse = '';
let isProcessing = false;
let currentImageData = null;
let isVisionMode = false;

// Scroll state
let userScrolledUp = false;
let scrollRafId = null;
let lastResponseId = null; // For LM Studio stateful chat
let abortController = null; // For cancelling active requests

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize custom i18n
    if (window.ci18n) {
        await window.ci18n.init();
    }

    // Apply i18n translations
    applyI18n();

    const chatContent = document.getElementById('chatContent');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const copyBtn = document.getElementById('copyBtn');
    const clearBtn = document.getElementById('clearBtn');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const removeImageBtn = document.getElementById('removeImageBtn');
    const summarizePageBtn = document.getElementById('summarizePageBtn');
    const askWebpageBtn = document.getElementById('askWebpageBtn');
    const quickActionsContainer = document.getElementById('quickActionsContainer');

    // Load settings
    settings = await chrome.storage.sync.get(getDefaultSettings());
    if (settings.showSummarizeBtn) {
        quickActionsContainer.style.display = 'flex';
    } else {
        quickActionsContainer.style.display = 'none';
    }

    // Detect if user manually scrolled up — if so, pause auto-scroll
    // But NOT during active streaming (isProcessing), since content growth triggers scroll events
    chatContent.addEventListener('scroll', () => {
        if (isProcessing) return; // Don't interfere during streaming
        const distanceFromBottom = chatContent.scrollHeight - chatContent.scrollTop - chatContent.clientHeight;
        userScrolledUp = distanceFromBottom > 120;
    });

    // Initial check for message
    await checkInitialMessage();

    // Listen for new message triggers (from background.js when window is reused)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'newInitialMessage') {
            checkInitialMessage();
        }
    });

    // Sync settings in real-time if they change in other windows
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync') {
            for (let [key, { newValue }] of Object.entries(changes)) {
                settings[key] = newValue;
            }
            if (changes.showSummarizeBtn !== undefined) {
                quickActionsContainer.style.display = changes.showSummarizeBtn.newValue ? 'flex' : 'none';
            }
        }
    });

    async function checkInitialMessage() {
        // Load settings in case they changed
        settings = await chrome.storage.sync.get(getDefaultSettings());

        const sessionData = await chrome.storage.session.get(['selectedText', 'isNewConversation', 'imageData']);

        if (sessionData.selectedText && sessionData.isNewConversation) {
            // Append to conversation for new request
            currentImageData = sessionData.imageData || null;
            isVisionMode = isVisionMode || !!currentImageData; // Update vision mode if image is present

            // Clear the flag
            await chrome.storage.session.set({ isNewConversation: false });

            // Send initial request
            const initialMessage = currentImageData
                ? sessionData.selectedText
                : `${settings.userRequest}\n\n${sessionData.selectedText}`;
            await sendMessage(initialMessage);
        } else if (conversationHistory.length === 0 && chatContent.innerHTML === '') {
            addSystemMessage(chrome.i18n.getMessage('noTextSelected') || 'No text selected. Use context menu on selected text.');
        }
    }

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    // Handle pasting images and text
    messageInput.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            // Handle image paste
            if (items[i].type.indexOf('image/') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                if (blob) processFile(blob);
                break;
            }
            // Handle plain text paste if needed (default behavior) or HTML content
            if (items[i].type === 'text/html') {
                // We'll let default happens for now, but we could extract images from HTML if needed
            }
        }
    });

    // Handle drag and drop images and text
    const dropZoneContainer = document.getElementById('dropZoneContainer');
    let dragCounter = 0; // To handle nested drag events

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZoneContainer.style.display = 'flex';
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropZoneContainer.style.display = 'none';
        }
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZoneContainer.style.display = 'none';

        const dt = e.dataTransfer;

        // 1. Handle files (direct drop of image files)
        if (dt.files && dt.files.length > 0) {
            const file = dt.files[0];
            if (file.type.startsWith('image/')) {
                await processFile(file);
                sendAdditionalMessage(); // Auto-send image
            }
            return;
        }

        // 2. Handle items (webpage drag-and-drop)
        if (dt.items) {
            for (let i = 0; i < dt.items.length; i++) {
                if (dt.items[i].type.startsWith('image/')) {
                    const blob = dt.items[i].getAsFile();
                    if (blob) {
                        await processFile(blob);
                        sendAdditionalMessage(); // Auto-send image
                        return;
                    }
                }
            }
        }

        // 3. Handle data URLs or plain text (dragging images from some sites or text selection)
        const html = dt.getData('text/html');
        if (html) {
            // Try to extract image source from HTML (e.g. from <img> tags)
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const img = doc.querySelector('img');
            if (img && img.src) {
                // If it's a data URL, use it directly
                if (img.src.startsWith('data:')) {
                    setImageData(img.src);
                    sendAdditionalMessage(); // Auto-send
                } else {
                    // Try to proxy/fetch the image URL via background script if needed, 
                    // or just use the URL if the model supports it (not common for local).
                    // For now, we'll try to fetch it if possible.
                    try {
                        const response = await fetch(img.src);
                        const blob = await response.blob();
                        await processFile(blob);
                        sendAdditionalMessage(); // Auto-send
                    } catch (err) {
                        console.error('Failed to fetch dragged image:', err);
                    }
                }
                return;
            }
        }

        const text = dt.getData('text/plain');
        if (text) {
            // Insert text into input
            const start = messageInput.selectionStart;
            const end = messageInput.selectionEnd;
            const val = messageInput.value;
            messageInput.value = val.substring(0, start) + text + val.substring(end);
            messageInput.focus();
            messageInput.dispatchEvent(new Event('input')); // Trigger resize
        }
    });

    // Helper to process a file/blob into the preview
    function processFile(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                // Ensure it's a standard format for LLMs
                if (blob.type === 'image/png' || blob.type === 'image/jpeg' || blob.type === 'image/webp') {
                    setImageData(dataUrl);
                } else {
                    // Convert to PNG via canvas
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        setImageData(canvas.toDataURL('image/png'));
                        resolve();
                    };
                    img.src = dataUrl;
                    return;
                }
                resolve();
            };
            reader.readAsDataURL(blob);
        });
    }

    // Function to set and preview image data
    function setImageData(base64Url) {
        currentImageData = base64Url;
        isVisionMode = true; // Auto-activate vision mode when image is pasted
        imagePreview.src = base64Url;
        imagePreviewContainer.style.display = 'inline-block';
        messageInput.focus();
    }

    // Function to clear image data
    function clearImageData() {
        currentImageData = null;
        imagePreview.src = '';
        imagePreviewContainer.style.display = 'none';
    }

    removeImageBtn.addEventListener('click', () => {
        clearImageData();
    });

    // Send on Enter (Shift+Enter for new line)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // Prevent sending if IME composition is active (for Korean/CJK)
            if (e.isComposing || e.nativeEvent?.isComposing) {
                return;
            }
            e.preventDefault();
            sendAdditionalMessage();
        }
    });

    // Handle send command
    sendBtn.addEventListener('click', () => {
        if (isProcessing) {
            // Cancel generation if already processing
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
        } else {
            sendAdditionalMessage();
        }
    });

    copyBtn.addEventListener('click', () => {
        if (lastAssistantResponse) {
            navigator.clipboard.writeText(lastAssistantResponse).then(() => {
                showToast(chrome.i18n.getMessage('copiedToClipboard') || 'Copied to clipboard!');
            });
        }
    });

    clearBtn.addEventListener('click', () => {
        conversationHistory = [];
        chatContent.innerHTML = '';
        lastAssistantResponse = '';
        lastResponseId = null;
        clearImageData();
        addSystemMessage(chrome.i18n.getMessage('conversationCleared') || 'Conversation cleared. Send a new message.');
    });

    // Reusable function to get active webpage context
    async function getWebpageInfo() {
        // Find the last focused normal window (not this popup/sidepanel if it's standalone)
        const lastWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        if (!lastWindow) {
            throw new Error("No active browser window found.");
        }

        const tabs = await chrome.tabs.query({ active: true, windowId: lastWindow.id });
        if (!tabs || tabs.length === 0) {
            throw new Error("No active tab found.");
        }

        const activeTab = tabs[0];

        // Cannot script chrome:// or edge:// URLs
        if (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://')) {
            throw new Error("Cannot extract from internal browser pages.");
        }

        // Extract page text by converting DOM to Markdown
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
                // A lightweight recursive function to convert DOM elements to basic Markdown
                function convertNodeToMarkdown(node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent.replace(/\s+/g, ' '); // Compress whitespace
                    }

                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        return '';
                    }

                    // Skip hidden elements, scripts, styles, etc.
                    const tag = node.tagName.toLowerCase();
                    const style = window.getComputedStyle(node);
                    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'iframe' || tag === 'svg' || style.display === 'none' || style.visibility === 'hidden') {
                        return '';
                    }

                    let md = '';
                    let prefix = '';
                    let postfix = '';

                    // Formatting blocks
                    if (tag === 'h1') { prefix = '\n# '; postfix = '\n'; }
                    else if (tag === 'h2') { prefix = '\n## '; postfix = '\n'; }
                    else if (tag === 'h3') { prefix = '\n### '; postfix = '\n'; }
                    else if (tag === 'h4') { prefix = '\n#### '; postfix = '\n'; }
                    else if (tag === 'h5') { prefix = '\n##### '; postfix = '\n'; }
                    else if (tag === 'h6') { prefix = '\n###### '; postfix = '\n'; }
                    else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') { prefix = '\n'; postfix = '\n'; }
                    else if (tag === 'br') { return '\n'; }
                    else if (tag === 'b' || tag === 'strong') { prefix = '**'; postfix = '**'; }
                    else if (tag === 'i' || tag === 'em') { prefix = '*'; postfix = '*'; }
                    else if (tag === 'code') { prefix = '`'; postfix = '`'; }
                    else if (tag === 'pre') { prefix = '\n```\n'; postfix = '\n```\n'; }
                    else if (tag === 'li') { prefix = '\n- '; }
                    else if (tag === 'a') {
                        const href = node.getAttribute('href');
                        if (href && !href.startsWith('javascript:')) {
                            prefix = '[';
                            // Postfix logic will capture the href in the recursive loop below
                        }
                    }

                    // Traverse children
                    let childrenContent = '';
                    for (const child of node.childNodes) {
                        childrenContent += convertNodeToMarkdown(child);
                    }

                    // Special postfix handling for links (anchor tags)
                    if (tag === 'a' && prefix === '[') {
                        // Resolve absolute URL
                        const href = node.getAttribute('href');
                        let absoluteUrl = href;
                        try {
                            absoluteUrl = new URL(href, window.location.href).href;
                        } catch (e) {
                            // Keep as is if invalid
                        }
                        postfix = `](${absoluteUrl})`;
                    }

                    // Images (basic alt text)
                    if (tag === 'img') {
                        const alt = node.getAttribute('alt') || 'Image';
                        return `[Image: ${alt}]`;
                    }

                    let result = prefix + childrenContent + postfix;

                    // Collapse excessive newlines inside inline elements to prevent bad formatting
                    if (['b', 'strong', 'i', 'em', 'a'].includes(tag)) {
                        result = result.replace(/\n+/g, ' ');
                    }

                    return result;
                }

                // Extract main content if available, otherwise body
                const mainCandidate = document.querySelector('main, article, [role="main"]') || document.body;

                let rawMarkdown = convertNodeToMarkdown(mainCandidate);

                // Clean up excessive empty lines
                return rawMarkdown.replace(/\n{3,}/g, '\n\n').trim();
            }
        });

        if (!injectionResults || !injectionResults[0] || !injectionResults[0].result) {
            throw new Error("Could not extract text from the page.");
        }

        let pageText = injectionResults[0].result.trim();
        if (!pageText) {
            throw new Error("Page seems to be empty.");
        }

        // Limit webpage text length aggressively to prevent LLM context starvation (e.g. max ~15000 chars)
        const MAX_TEXT_LENGTH = 15000;
        if (pageText.length > MAX_TEXT_LENGTH) {
            pageText = pageText.substring(0, MAX_TEXT_LENGTH) + '\n\n[... Text truncated due to length limits ...]';
        }

        return { pageText, pageTitle: activeTab.title || 'Webpage' };
    }

    summarizePageBtn.addEventListener('click', async () => {
        if (isProcessing) return;

        try {
            // Ensure settings are completely up to date
            settings = await chrome.storage.sync.get(getDefaultSettings());
            const { pageText, pageTitle } = await getWebpageInfo();
            const prompt = settings.summarizePrompt || 'Summarize the following webpage content:';
            const fullMessage = `${prompt}\n\n${pageText}`;

            // Create a truncated display message for the UI
            const displayMessage = i18n('summarizeWebpageDisplayMsg', `📄 Summarizing **$1**...`).replace('$1', pageTitle);

            // Clean up any pending image
            clearImageData();

            // Send the full message to the LLM, but show the displayMessage in the UI
            await sendMessage(fullMessage, displayMessage);

        } catch (error) {
            console.error('[Local AI Assistant] Summarize error:', error);
            showToast(error.message || 'Failed to summarize page.');
        }
    });

    askWebpageBtn.addEventListener('click', async () => {
        if (isProcessing) return;

        try {
            // Ensure settings are completely up to date
            settings = await chrome.storage.sync.get(getDefaultSettings());
            const { pageText, pageTitle } = await getWebpageInfo();
            const prompt = settings.askWebpagePrompt || "Once the webpage content is fully received, reply with 'Now you can ask'.";

            // Format for Ask Webpage: Context first, then instruction prompt
            const fullMessage = `[Webpage Context: ${pageTitle}]\n\n${pageText}\n\n---\n${prompt}`;

            // Create a truncated display message for the UI
            const displayMessage = i18n('askWebpageDisplayMsg', `📄 Sending context of **$1**...`).replace('$1', pageTitle);

            // Clean up any pending image
            clearImageData();

            // Send the full message to the LLM, but show the displayMessage in the UI
            await sendMessage(fullMessage, displayMessage);

        } catch (error) {
            console.error('[Local AI Assistant] Ask Webpage error:', error);
            showToast(error.message || 'Failed to extract page context.');
        }
    });

    async function sendAdditionalMessage() {
        const message = messageInput.value.trim();
        // Allow sending if there's an image even if there's no text (we'll use default prompt)
        if ((!message && !currentImageData) || isProcessing) return;

        // Reset scroll lock when user sends a new message
        userScrolledUp = false;

        messageInput.value = '';
        messageInput.style.height = 'auto';

        let finalMessage = message;
        if (currentImageData && !finalMessage) {
            // Use default prompt if image is attached but no text is provided
            settings = await chrome.storage.sync.get(getDefaultSettings());
            finalMessage = settings.visionPrompt;
        }

        await sendMessage(finalMessage);
    }

    async function sendMessage(userMessage, displayMessage = null) {
        // Always reset scroll lock when a new response starts
        userScrolledUp = false;
        isProcessing = true;

        // Setup AbortController for this request
        abortController = new AbortController();
        updateSendButtonState();

        const messageToDisplay = displayMessage || userMessage;

        // Add user bubble (show image thumbnail if exists)
        if (currentImageData) {
            addImageBubble(currentImageData, messageToDisplay);
        } else {
            addBubble(messageToDisplay, 'user');
        }

        // Add user message to history (with image if exists)
        if (currentImageData) {
            isVisionMode = true;
            // Use full data URL format
            conversationHistory.push({
                role: 'user',
                content: [
                    { type: 'text', text: userMessage },
                    { type: 'image_url', image_url: { url: currentImageData } }
                ]
            });
        } else {
            conversationHistory.push({
                role: 'user',
                content: userMessage
            });
        }

        // Trim history if needed
        const maxMessages = settings.maxHistory * 2;
        if (conversationHistory.length > maxMessages) {
            conversationHistory = conversationHistory.slice(-maxMessages);
        }

        // Store the image data locally for the request builder before clearing UI
        const requestImageData = currentImageData;

        // Clear image data so UI updates instantly (but we keep a local reference)
        clearImageData();

        // Create assistant bubble with loading indicator
        const assistantBubble = addBubble('', 'assistant', true);

        try {
            // Use vision-specific system role for image analysis
            const systemContent = isVisionMode && conversationHistory.length <= 1
                ? 'You are a helpful vision assistant that can analyze and describe images in detail. Respond in the same language as the user\'s request.'
                : settings.systemRole;

            const messages = [
                { role: 'system', content: systemContent },
                ...conversationHistory
            ];

            if (settings.llmMode === 'lmstudio') {
                // Use LM Studio native stateful API which supports multimodal using input array
                await lmStudioStreamResponse(userMessage, requestImageData, assistantBubble);
            } else if (settings.useStreaming) {
                await streamResponse(messages, assistantBubble);
            } else {
                await normalResponse(messages, assistantBubble);
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                assistantBubble.classList.remove('streaming');

                // Remove loading animations and progress metadata blocks
                assistantBubble.querySelectorAll('.typing-indicator, .progress-status, .model-load-status').forEach(el => el.remove());

                // If the bubble is completely empty after removing loaders
                if (!assistantBubble.textContent.trim() && !assistantBubble.querySelector('img')) {
                    assistantBubble.innerHTML = `*(Generation stopped by user)*`;
                } else {
                    assistantBubble.innerHTML += '<br><br>*(Generation stopped by user)*';
                }

                // Mark reasoning box as done to collapse it
                showReasoningStatus(assistantBubble, null, false, settings.useThinking, true);

                lastAssistantResponse = assistantBubble.innerText;
            } else {
                assistantBubble.classList.remove('streaming');
                assistantBubble.classList.add('error');
                assistantBubble.innerHTML = renderMarkdown(`**Error**\n\n${error.message}\n\n${chrome.i18n.getMessage('errorMessage') || 'Please check if Local AI Assistant is running.'}`);
                lastAssistantResponse = error.message;
            }
        } finally {
            isProcessing = false;
            abortController = null;
            updateSendButtonState();
            messageInput.focus();
            scrollToBottom();
        }
    }

    function updateSendButtonState() {
        if (isProcessing) {
            sendBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="stop-icon">
                    <rect x="6" y="6" width="12" height="12" fill="currentColor" rx="2" />
                </svg>`;
            sendBtn.title = chrome.i18n.getMessage('stopGenerationTitle') || 'Stop Generation';
            sendBtn.classList.add('stop-btn');
            sendBtn.disabled = false;
        } else {
            sendBtn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
                </svg>`;
            sendBtn.title = chrome.i18n.getMessage('sendBtnTitle') || 'Send Message';
            sendBtn.classList.remove('stop-btn');
            sendBtn.disabled = false;
        }
    }

    async function normalResponse(messages, bubble) {
        const requestBody = {
            model: settings.modelKey || 'local-model',
            messages: messages,
            max_tokens: settings.maxTokens,
            temperature: settings.temperature,
            stream: false
        };

        const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
            },
            body: JSON.stringify(requestBody),
            signal: abortController ? abortController.signal : undefined
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || 'No response received.';

        conversationHistory.push({ role: 'assistant', content: content });
        lastAssistantResponse = content;

        bubble.classList.remove('streaming');
        bubble.innerHTML = renderMarkdown(content);
    }

    async function streamResponse(messages, bubble) {
        bubble.classList.add('streaming');
        bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

        const requestBody = {
            model: settings.modelKey || 'local-model',
            messages: messages,
            max_tokens: settings.maxTokens,
            temperature: settings.temperature,
            stream: true
        };

        const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
            },
            body: JSON.stringify(requestBody),
            signal: abortController ? abortController.signal : undefined
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = ''; // Keep track of reasoning separately if sent in reasoning_content field
        let buffer = '';

        // Helper to strip thinking tags and content for display
        function stripThinking(text) {
            if (!text) return '';
            // Remove complete think blocks
            let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
            // Handle partial blocks: if there's an unclosed <think>, strip everything after it
            const openTagIdx = cleaned.toLowerCase().lastIndexOf('<think>');
            if (openTagIdx !== -1) {
                cleaned = cleaned.substring(0, openTagIdx);
            }
            return cleaned.trim();
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last incomplete line in the buffer

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('data: ')) {
                    const data = trimmedLine.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta || {};
                        const content = delta.content || '';
                        const reasoning = delta.reasoning_content || ''; // Support for Ollama/DeepSeek reasoning field

                        if (content || reasoning) {
                            if (content) fullContent += content;
                            if (reasoning) fullReasoning += reasoning;

                            // --- Thinking Box Update ---
                            // If reasoning is in reasoning_content, use that. 
                            // If it's in content tags, extract it.
                            let currentReasoning = fullReasoning;
                            if (fullContent.includes('<think>')) {
                                if (fullContent.includes('</think>')) {
                                    currentReasoning = fullContent.match(/<think>([\s\S]*?)<\/think>/i)[1];
                                } else {
                                    currentReasoning = fullContent.split(/<think>/i).pop();
                                }
                            }

                            if (currentReasoning || fullContent.includes('<think>')) {
                                const isDone = fullContent.includes('</think>');
                                showReasoningStatus(bubble, currentReasoning, false, settings.useThinking, isDone);
                            }

                            // --- Main Bubble Display (real-time markdown rendering) ---
                            let displayText = stripThinking(fullContent);

                            if (displayText) {
                                bubble.innerHTML = renderMarkdown(displayText);
                            }
                            // Force immediate scroll during streaming
                            chatContent.scrollTop = chatContent.scrollHeight;
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }

        if (!fullContent) {
            fullContent = 'No response received.';
        }

        // Final render: prioritize stripped content
        let finalDisplay = stripThinking(fullContent);

        // If after stripping we have nothing, it means the entire response was thinking
        // In that case, we show an empty string or a small hint, but NOT the raw <think> tags
        bubble.innerHTML = renderMarkdown(finalDisplay);

        // Add to history (including reasoning if any)
        conversationHistory.push({ role: 'assistant', content: fullContent });
        lastAssistantResponse = fullContent;
        bubble.classList.remove('streaming');
        showReasoningStatus(bubble, null, true, settings.useThinking);
    }

    // =========================================================================
    // LM Studio Native API (/api/v1/chat) - Streaming with Named SSE Events
    // =========================================================================
    async function lmStudioStreamResponse(userMessage, imageData, bubble) {
        bubble.classList.add('streaming');
        bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

        // Prepare input payload (support LM Studio multimodal format)
        const inputPayload = imageData ? [
            { type: 'text', content: userMessage || 'Please describe this image.' },
            { type: 'image', data_url: imageData }
        ] : userMessage;

        // Build request body
        const requestBody = {
            model: settings.modelKey || 'local-model',
            input: inputPayload,
            stream: true,
            temperature: settings.temperature,
            max_output_tokens: settings.maxTokens,
            store: true
        };

        // System prompt only on first message (no previous_response_id)
        if (!lastResponseId) {
            requestBody.system_prompt = settings.systemRole;
        }

        // Chain to previous response for multi-turn
        if (lastResponseId) {
            requestBody.previous_response_id = lastResponseId;
        }

        // MCP integrations
        if (settings.mcpServerLabel) {
            requestBody.integrations = [{
                type: 'plugin',
                id: `mcp/${settings.mcpServerLabel}`
            }];
        }

        const response = await fetch(`http://${settings.serverAddress}/api/v1/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
            },
            body: JSON.stringify(requestBody),
            signal: abortController ? abortController.signal : undefined
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`LM Studio API error (${response.status}): ${errorBody}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = '';
        let buffer = '';
        let currentEventType = null;
        let isFirstContent = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Parse named SSE events: "event: <type>" followed by "data: <json>"
                if (trimmed.startsWith('event:')) {
                    currentEventType = trimmed.substring(6).trim();
                    continue;
                }

                if (!trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.substring(5).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                let eventData;
                try {
                    eventData = JSON.parse(jsonStr);
                } catch (e) {
                    continue;
                }

                // Use event type from named event or from data.type
                const eventType = currentEventType || eventData.type;
                currentEventType = null; // Reset after use

                switch (eventType) {
                    case 'message.delta': {
                        const content = eventData.content || '';
                        if (content) {
                            if (isFirstContent) {
                                bubble.innerHTML = '';
                                isFirstContent = false;
                                // Remove any leftover progress indicators when real content starts
                                bubble.querySelectorAll('.progress-status, .model-load-status').forEach(el => el.remove());
                            }
                            fullContent += content;
                            bubble.innerHTML = renderMarkdown(fullContent);
                            chatContent.scrollTop = chatContent.scrollHeight;
                        }
                        break;
                    }

                    case 'reasoning.start':
                        showReasoningStatus(bubble, '', false, settings.useThinking);
                        break;

                    case 'reasoning.delta': {
                        const reasonContent = eventData.content || '';
                        if (reasonContent) {
                            fullReasoning += reasonContent;
                            showReasoningStatus(bubble, fullReasoning, false, settings.useThinking);
                        }
                        break;
                    }

                    case 'reasoning.end':
                        showReasoningStatus(bubble, fullReasoning, false, settings.useThinking, true);
                        break;

                    case 'tool_call.start': {
                        const toolName = eventData.tool || 'Tools';
                        if (isFirstContent) {
                            bubble.innerHTML = '';
                            isFirstContent = false;
                        }
                        const toolEl = document.createElement('div');
                        toolEl.className = 'tool-call-status';
                        toolEl.id = `tool-${Date.now()}`;
                        toolEl.innerHTML = `<span class="tool-icon">🔧</span> <strong>${toolName}</strong> <span class="tool-state">calling...</span>`;
                        bubble.appendChild(toolEl);
                        chatContent.scrollTop = chatContent.scrollHeight;
                        break;
                    }

                    case 'tool_call.arguments':
                        // Arguments are being streamed - could show them if desired
                        break;

                    case 'tool_call.success': {
                        const toolEls = bubble.querySelectorAll('.tool-call-status');
                        if (toolEls.length > 0) {
                            const lastTool = toolEls[toolEls.length - 1];
                            lastTool.querySelector('.tool-state').textContent = '✅ done';
                            lastTool.classList.add('tool-success');
                        }
                        break;
                    }

                    case 'tool_call.failure': {
                        const reason = eventData.reason || 'Unknown error';
                        const toolElsFail = bubble.querySelectorAll('.tool-call-status');
                        if (toolElsFail.length > 0) {
                            const lastTool = toolElsFail[toolElsFail.length - 1];
                            lastTool.querySelector('.tool-state').textContent = `❌ ${reason}`;
                            lastTool.classList.add('tool-failure');
                        }
                        break;
                    }

                    case 'chat.end': {
                        // Capture response_id for stateful chaining
                        if (eventData.result && eventData.result.response_id) {
                            lastResponseId = eventData.result.response_id;
                        }
                        break;
                    }

                    case 'model_load.start':
                        showInlineProgress(bubble, 'model-load', 'Loading Model...');
                        break;

                    case 'model_load.progress': {
                        const pct = Math.round((eventData.progress || 0) * 100);
                        showInlineProgress(bubble, 'model-load', `Loading Model... ${pct}%`, pct);
                        break;
                    }

                    case 'model_load.end':
                        showInlineProgress(bubble, 'model-load', '✓ Model Loaded', 100, true);
                        break;

                    case 'prompt_processing.start':
                        showInlineProgress(bubble, 'prompt-proc', 'Processing Prompt...');
                        break;

                    case 'prompt_processing.progress': {
                        const pct = Math.round((eventData.progress || 0) * 100);
                        showInlineProgress(bubble, 'prompt-proc', `Processing Prompt... ${pct}%`, pct);
                        break;
                    }

                    case 'prompt_processing.end':
                        showInlineProgress(bubble, 'prompt-proc', '✓ Prompt Processed', 100, true);
                        break;

                    case 'error': {
                        const errMsg = eventData.error?.message || 'Unknown error';
                        throw new Error(errMsg);
                    }

                    default:
                        // chat.start, message.start, message.end, model_load.end, prompt_processing.end
                        break;
                }
            }
        }

        // Final render
        if (fullContent) {
            bubble.innerHTML = renderMarkdown(fullContent);
        } else if (isFirstContent) {
            bubble.innerHTML = '<em>No response received</em>';
        }

        conversationHistory.push({ role: 'assistant', content: fullContent });
        lastAssistantResponse = fullContent;
        bubble.classList.remove('streaming');
        showReasoningStatus(bubble, null, true, settings.useThinking);
    }
    // Show/Hide Inline Progress Helper
    function showInlineProgress(bubble, type, text, pct = 0, isDone = false) {
        const statusClass = type === 'model-load' ? 'model-load-status' : 'progress-status';
        const statusId = `${type}-${bubble.id || Date.now()}`;
        let statusEl = document.getElementById(statusId);

        if (isDone) {
            if (statusEl) {
                const bar = statusEl.querySelector('.progress-bar-fill');
                const textEl = statusEl.querySelector('.status-label');
                if (bar) bar.style.width = '100%';
                if (textEl && text) textEl.textContent = text;
                setTimeout(() => {
                    if (statusEl && statusEl.parentNode) statusEl.remove();
                }, 1500);
            }
            return;
        }

        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = statusId;
            statusEl.className = statusClass;
            statusEl.innerHTML = `
                <div class="status-text">
                    <span class="status-label">${text}</span>
                    <span class="status-percent">${pct}%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${pct}%"></div>
                </div>
            `;
            bubble.appendChild(statusEl);
        } else {
            const bar = statusEl.querySelector('.progress-bar-fill');
            const label = statusEl.querySelector('.status-label');
            const percent = statusEl.querySelector('.status-percent');
            if (bar) bar.style.width = `${pct}%`;
            if (label) label.textContent = text;
            if (percent) percent.textContent = `${pct}%`;
        }
        chatContent.scrollTop = chatContent.scrollHeight;
    }

    // Show/Hide Reasoning Status Helper
    // isDone=true: thinking complete, collapse box with elapsed time
    // isFinal=true: stream done, remove element entirely
    function showReasoningStatus(bubble, text, isFinal = false, useThinking = false, isDone = false) {
        let statusId = bubble.hasAttribute('data-reasoning-id')
            ? bubble.getAttribute('data-reasoning-id')
            : null;

        let statusEl = statusId ? document.getElementById(statusId) : null;

        if (isFinal) {
            if (statusEl) statusEl.remove();
            return;
        }

        // Do not show reasoning at all if useThinking is off
        if (!useThinking) return;

        if (!statusEl) {
            statusId = 'reasoning-' + Date.now();
            bubble.setAttribute('data-reasoning-id', statusId);
            bubble.dataset.thinkStart = Date.now();

            statusEl = document.createElement('div');
            statusEl.id = statusId;
            statusEl.className = 'reasoning-status thinking-expanded';
            statusEl.innerHTML = `
                <div class="reasoning-header">
                    <span class="reasoning-icon">💭</span> Thinking...
                </div>
                <div class="reasoning-body"></div>`;
            // Insert BEFORE the bubble so it appears on top of the final response
            // This prevents scroll jumping because the expanding element pushes the chat down
            bubble.parentNode.insertBefore(statusEl, bubble);
        }

        if (isDone) {
            // Collapse with elapsed time, transition upward
            const elapsed = bubble.dataset.thinkStart
                ? ((Date.now() - parseInt(bubble.dataset.thinkStart)) / 1000).toFixed(1)
                : '?';
            statusEl.innerHTML = `
                <div class="reasoning-header reasoning-done-header">
                    ✓ Thought for ${elapsed}s
                </div>`;
            statusEl.className = 'reasoning-status thinking-done';
        } else {
            // Update inner body text (accumulate, scroll to bottom inside box)
            const bodyEl = statusEl.querySelector('.reasoning-body');
            if (bodyEl) {
                bodyEl.textContent = (text || '').trimStart();
                // Auto-scroll inner box to bottom so latest text is visible
                bodyEl.scrollTop = bodyEl.scrollHeight;
            }
        }

        // Scroll the thinking element into view after layout
        // scrollIntoView is more reliable than scrollTop after DOM insertion
        requestAnimationFrame(() => {
            if (statusEl && statusEl.parentNode) {
                // Ensure the status element is visible
                statusEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                // Also trigger main chat scroll to ensure bubble stays in view
                chatContent.scrollTop = chatContent.scrollHeight;
            }
        });
    }

    function addBubble(content, role, isLoading = false) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        bubble.id = `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        if (isLoading) {
            bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        } else {
            bubble.innerHTML = role === 'user' ? escapeHtml(content) : renderMarkdown(content);
        }

        chatContent.appendChild(bubble);
        scrollToBottom();
        return bubble;
    }

    function addImageBubble(imageData, text) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble user image-bubble';

        const img = document.createElement('img');
        img.src = imageData;
        img.alt = 'Uploaded image';
        img.className = 'chat-image';

        const textDiv = document.createElement('div');
        textDiv.className = 'image-text';
        textDiv.textContent = text;

        bubble.appendChild(img);
        bubble.appendChild(textDiv);
        chatContent.appendChild(bubble);
        scrollToBottom();
        return bubble;
    }

    function addSystemMessage(message) {
        const div = document.createElement('div');
        div.className = 'chat-bubble assistant';
        div.style.opacity = '0.6';
        div.textContent = message;
        chatContent.appendChild(div);
    }

    function scrollToBottom(force = false) {
        // Skip if user has scrolled up, unless forced
        if (userScrolledUp && !force) return;

        // Use a small delay and double rAF to guarantee layout computation is fully complete after DOM insertion
        // especially important for elements with CSS transitions or new images
        if (scrollRafId) clearTimeout(scrollRafId);
        scrollRafId = setTimeout(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    chatContent.scrollTop = chatContent.scrollHeight;
                    scrollRafId = null;
                });
            });
        }, 10);
    }
});

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Simple Markdown to HTML renderer
function renderMarkdown(text) {
    if (!text) return '';

    let html = text;

    // First preserve existing <think> tags before escaping
    const thinkBlocks = [];
    html = html.replace(/<think>([\s\S]*?)<\/think>/gi, (match) => {
        thinkBlocks.push(match);
        return `__THINK_BLOCK_${thinkBlocks.length - 1}__`;
    });

    // Escape HTML (but preserve our placeholders)
    html = html.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Restore think blocks
    thinkBlocks.forEach((block, index) => {
        html = html.replace(`__THINK_BLOCK_${index}__`, block);
    });

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and Italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Unordered lists
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // Ordered lists (numbered)
    html = html.replace(/^\d+\. (.+)$/gm, '<ol><li>$1</li></ol>');
    html = html.replace(/<\/ol>\s*<ol>/g, '');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Paragraphs
    html = html.split(/\n\n+/).map(para => {
        para = para.trim();
        if (para && !para.startsWith('<h') && !para.startsWith('<ul') &&
            !para.startsWith('<ol') && !para.startsWith('<pre') &&
            !para.startsWith('<blockquote') && !para.startsWith('<hr')) {
            return `<p>${para}</p>`;
        }
        return para;
    }).join('\n');

    // Single newlines to <br>
    html = html.replace(/([^>])\n([^<])/g, '$1<br>$2');

    return html;
}
