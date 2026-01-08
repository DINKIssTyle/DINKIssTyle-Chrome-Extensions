/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

// Get i18n message helper
function i18n(key, fallback = '') {
    return chrome.i18n.getMessage(key) || fallback;
}

// Default settings with i18n support
function getDefaultSettings() {
    return {
        serverAddress: 'localhost:1234',
        modelKey: '',
        maxTokens: 2048,
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

let conversationHistory = [];
let settings = {};
let lastAssistantResponse = '';
let isProcessing = false;
let currentImageData = null;
let isVisionMode = false;

document.addEventListener('DOMContentLoaded', async () => {
    const chatContent = document.getElementById('chatContent');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const copyBtn = document.getElementById('copyBtn');
    const clearBtn = document.getElementById('clearBtn');

    // Load settings
    settings = await chrome.storage.sync.get(getDefaultSettings());

    // Check for initial text and image
    const sessionData = await chrome.storage.session.get(['selectedText', 'isNewConversation', 'imageData']);

    if (sessionData.selectedText && sessionData.isNewConversation) {
        // Reset conversation for new request
        conversationHistory = [];
        chatContent.innerHTML = '';
        currentImageData = sessionData.imageData || null;
        isVisionMode = !!currentImageData;

        // Clear the flag
        await chrome.storage.session.set({ isNewConversation: false });

        // Send initial request
        const initialMessage = currentImageData
            ? sessionData.selectedText
            : `${settings.userRequest}\n\n${sessionData.selectedText}`;
        await sendMessage(initialMessage);
    } else {
        addSystemMessage(chrome.i18n.getMessage('noTextSelected') || 'No text selected. Use context menu on selected text.');
    }

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    // Send on Enter (Shift+Enter for new line)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
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
        currentImageData = null;
        addSystemMessage(chrome.i18n.getMessage('conversationCleared') || 'Conversation cleared. Send a new message.');
    });

    async function sendAdditionalMessage() {
        const message = messageInput.value.trim();
        if (!message || isProcessing) return;

        messageInput.value = '';
        messageInput.style.height = 'auto';
        await sendMessage(message);
    }

    async function sendMessage(userMessage) {
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

            // Clear image data after first message
            currentImageData = null;

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
        const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.modelKey || 'local-model',
                messages: messages,
                max_tokens: settings.maxTokens,
                temperature: settings.temperature,
                stream: false
            })
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

        const response = await fetch(`http://${settings.serverAddress}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.modelKey || 'local-model',
                messages: messages,
                max_tokens: settings.maxTokens,
                temperature: settings.temperature,
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let isFirstChunk = true;

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
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            if (isFirstChunk) {
                                bubble.innerHTML = '';
                                isFirstChunk = false;
                            }
                            fullContent += delta;
                            bubble.innerHTML = renderMarkdown(fullContent);
                            scrollToBottom();
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }

        if (!fullContent) {
            fullContent = 'No response received.';
            bubble.innerHTML = renderMarkdown(fullContent);
        }

        conversationHistory.push({ role: 'assistant', content: fullContent });
        lastAssistantResponse = fullContent;
        bubble.classList.remove('streaming');
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

    function scrollToBottom() {
        chatContent.scrollTop = chatContent.scrollHeight;
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
