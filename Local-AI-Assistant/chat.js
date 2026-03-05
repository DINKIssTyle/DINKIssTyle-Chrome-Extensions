/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

// Get i18n message helper
function i18n(key, fallback = '') {
    return chrome.i18n.getMessage(key) || fallback;
}

// Apply i18n translations
function applyI18n() {
    // Apply text content translations
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });

    // Apply placeholder translations
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.placeholder = message;
        }
    });

    // Apply title translations
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.title = message;
        }
    });
}

// Default settings with i18n support
function getDefaultSettings() {
    return {
        serverAddress: 'localhost:1234',
        apiKey: '',
        modelKey: '',
        maxTokens: 2048,
        temperature: 0.7,
        maxHistory: 10,
        useStreaming: false,
        useThinking: false,
        useMcpTools: false,
        useVisionMode: false,
        useSidePanel: false,
        visionPrompt: i18n('defaultVisionPrompt', 'Describe this image in detail.'),
        useTextEnhancement: false,
        textEnhancementPrompt: i18n('defaultEnhancementPrompt', 'Improve the following text to be more clear, professional, and well-structured. Return only the improved text in JSON format with key "enhanced_text":'),
        systemRole: i18n('defaultSystemRole', 'You are an expert at processing web articles, posts, and other content.'),
        userRequest: i18n('defaultUserRequest', 'Summarize the following text:')
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

document.addEventListener('DOMContentLoaded', async () => {
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

    // Load settings
    settings = await chrome.storage.sync.get(getDefaultSettings());

    // Detect if user manually scrolled up — if so, pause auto-scroll
    chatContent.addEventListener('scroll', () => {
        const distanceFromBottom = chatContent.scrollHeight - chatContent.scrollTop - chatContent.clientHeight;
        userScrolledUp = distanceFromBottom > 80;
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

    // Handle pasting images
    messageInput.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') !== -1) {
                e.preventDefault(); // Prevent pasting text representation (e.g. filename)

                const blob = items[i].getAsFile();
                if (!blob) continue;

                // For formats like WebP or others, use a canvas to enforce PNG/JPEG if necessary,
                // but local LLMs usually handle base64 PNG/JPEG fine.
                // We'll read it as a DataURL block.
                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result;

                    // If it's already PNG/JPEG we can just use it, else we convert
                    if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
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
                        };
                        img.src = dataUrl;
                    }
                };
                reader.readAsDataURL(blob);

                // Stop after the first image
                break;
            }
        }
    });

    // Handle drag and drop images
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    document.body.addEventListener('drop', (e) => {
        e.preventDefault();
        const items = e.dataTransfer?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') !== -1) {
                const blob = items[i].getAsFile();
                if (!blob) continue;

                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result;
                    if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
                        setImageData(dataUrl);
                    } else {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.naturalWidth;
                            canvas.height = img.naturalHeight;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            setImageData(canvas.toDataURL('image/png'));
                        };
                        img.src = dataUrl;
                    }
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    });

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

    sendBtn.addEventListener('click', sendAdditionalMessage);

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
        clearImageData();
        addSystemMessage(chrome.i18n.getMessage('conversationCleared') || 'Conversation cleared. Send a new message.');
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
            finalMessage = settings.visionPrompt;
        }

        await sendMessage(finalMessage);
    }

    async function sendMessage(userMessage) {
        // Always reset scroll lock when a new response starts
        userScrolledUp = false;
        isProcessing = true;
        sendBtn.disabled = true;

        // Add user bubble (show image thumbnail if exists)
        if (currentImageData && conversationHistory.length === 0) {
            addImageBubble(currentImageData, userMessage);
        } else {
            addBubble(userMessage, 'user');
        }

        // Add user message to history (with image if exists)
        if (currentImageData && conversationHistory.length === 0) {
            // Use full data URL format: data:image/jpeg;base64,{base64_data}
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

        // Clear image data BEFORE sending, so UI updates instantly
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

            if (settings.useStreaming) {
                await streamResponse(messages, assistantBubble);
            } else {
                await normalResponse(messages, assistantBubble);
            }

        } catch (error) {
            assistantBubble.classList.remove('streaming');
            assistantBubble.classList.add('error');
            assistantBubble.innerHTML = renderMarkdown(`**Error**\n\n${error.message}\n\n${chrome.i18n.getMessage('errorMessage') || 'Please check if Local AI Assistant is running.'}`);
            lastAssistantResponse = error.message;
        } finally {
            isProcessing = false;
            sendBtn.disabled = false;
            messageInput.focus();
            scrollToBottom();
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

        // Add tools parameter if MCP Tools is enabled
        if (settings.useMcpTools) {
            requestBody.tools = [{
                type: "function",
                function: {
                    name: "use_mcp_tool",
                    description: "Use a Model Context Protocol (MCP) tool to perform an action",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string" }
                        },
                        required: ["query"]
                    }
                }
            }];
            requestBody.tool_choice = 'auto';
        }

        const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
            },
            body: JSON.stringify(requestBody)
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

        // Add tools parameter if MCP Tools is enabled
        if (settings.useMcpTools) {
            requestBody.tools = [{
                type: "function",
                function: {
                    name: "use_mcp_tool",
                    description: "Use a Model Context Protocol (MCP) tool to perform an action",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string" }
                        },
                        required: ["query"]
                    }
                }
            }];
            requestBody.tool_choice = 'auto';
        }

        const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = ''; // Keep track of reasoning separately if sent in reasoning_content field
        let isFirstChunk = true;

        // Helper to strip thinking tags and content for display
        function stripThinking(text) {
            if (!text) return '';
            let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
            // Handle partial blocks
            if (cleaned.includes('<think>')) {
                cleaned = cleaned.split(/<think>/i)[0];
            }
            if (cleaned.includes('</think>')) {
                cleaned = cleaned.split(/<\/think>/i).pop();
            }
            return cleaned.trim();
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta || {};
                        const content = delta.content || '';
                        const reasoning = delta.reasoning_content || ''; // Support for Ollama/DeepSeek reasoning field

                        if (content || reasoning) {
                            if (isFirstChunk) {
                                bubble.innerHTML = '<div class="streaming-text"></div>';
                                isFirstChunk = false;
                            }

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

                            // --- Main Bubble Display ---
                            let displayText = stripThinking(fullContent);

                            const streamingEl = bubble.querySelector('.streaming-text');
                            if (streamingEl) {
                                streamingEl.textContent = displayText;
                            }
                            scrollToBottom(true);
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
                statusEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            }
        });
    }

    function addBubble(content, role, isLoading = false) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;

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

    // Escape HTML
    html = html.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

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

    // Lists
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

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
