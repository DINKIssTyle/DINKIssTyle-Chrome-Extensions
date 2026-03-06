/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

// Get i18n message helper
function i18n(key, fallback = '') {
    return (window.ci18n ? window.ci18n.getMessage(key) : chrome.i18n.getMessage(key)) || fallback;
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
        summarizePrompt: i18n('defaultSummarizePrompt', 'Summarize the following webpage content:'),
        askWebpagePrompt: i18n('defaultAskWebpagePrompt', 'Once the webpage content is fully received, reply with "Now you can ask".')
    };
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
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize custom i18n
    if (window.ci18n) {
        await window.ci18n.init();
    }

    // Apply translations
    applyI18n();

    const serverAddressInput = document.getElementById('serverAddress');
    const apiKeyInput = document.getElementById('apiKey');
    const modelKeyInput = document.getElementById('modelKey');
    const maxTokensInput = document.getElementById('maxTokens');
    const temperatureInput = document.getElementById('temperature');
    const maxHistoryInput = document.getElementById('maxHistory');
    const useStreamingInput = document.getElementById('useStreaming');
    const useThinkingInput = document.getElementById('useThinking');
    const llmModeInput = document.getElementById('llmMode');
    const mcpServerLabelInput = document.getElementById('mcpServerLabel');
    const mcpServerLabelContainer = document.getElementById('mcpServerLabelContainer');
    const maxHistoryContainer = document.getElementById('maxHistoryContainer');
    const useVisionModeInput = document.getElementById('useVisionMode');
    const useSidePanelInput = document.getElementById('useSidePanel');
    const showSummarizeBtnInput = document.getElementById('showSummarizeBtn');
    const visionPromptInput = document.getElementById('visionPrompt');
    const visionPromptContainer = document.getElementById('visionPromptContainer');
    const useTextEnhancementInput = document.getElementById('useTextEnhancement');
    const textEnhancementPromptInput = document.getElementById('textEnhancementPrompt');
    const enhancementPromptContainer = document.getElementById('enhancementPromptContainer');
    const systemRoleInput = document.getElementById('systemRole');
    const userRequestInput = document.getElementById('userRequest');
    const summarizePromptInput = document.getElementById('summarizePrompt');
    const askWebpagePromptInput = document.getElementById('askWebpagePrompt');
    const uiLanguageInput = document.getElementById('uiLanguage');
    const saveBtn = document.getElementById('saveBtn');
    const statusText = document.getElementById('statusText');

    // Toggle prompt visibility based on toggle states
    function updatePromptVisibility() {
        if (useVisionModeInput && visionPromptContainer) {
            if (useVisionModeInput.checked) {
                visionPromptContainer.classList.add('visible');
            } else {
                visionPromptContainer.classList.remove('visible');
            }
        }

        if (useTextEnhancementInput && enhancementPromptContainer) {
            if (useTextEnhancementInput.checked) {
                enhancementPromptContainer.classList.add('visible');
            } else {
                enhancementPromptContainer.classList.remove('visible');
            }
        }
    }

    // Toggle visibility of mode-specific settings
    function updateModeVisibility() {
        if (!llmModeInput) return;

        const isLmStudio = llmModeInput.value === 'lmstudio';

        if (mcpServerLabelContainer) {
            if (isLmStudio) {
                mcpServerLabelContainer.classList.add('visible');
            } else {
                mcpServerLabelContainer.classList.remove('visible');
            }
        }

        if (maxHistoryContainer) {
            if (isLmStudio) {
                maxHistoryContainer.classList.remove('visible');
            } else {
                maxHistoryContainer.classList.add('visible');
            }
        }
    }
    if (llmModeInput) llmModeInput.addEventListener('change', updateModeVisibility);

    useVisionModeInput.addEventListener('change', updatePromptVisibility);
    useTextEnhancementInput.addEventListener('change', updatePromptVisibility);

    // Load saved settings
    const defaults = getDefaultSettings();
    chrome.storage.sync.get(defaults, (settings) => {
        if (serverAddressInput) serverAddressInput.value = settings.serverAddress;
        if (apiKeyInput) apiKeyInput.value = settings.apiKey;
        if (modelKeyInput) modelKeyInput.value = settings.modelKey;
        if (maxTokensInput) maxTokensInput.value = settings.maxTokens;
        if (temperatureInput) temperatureInput.value = settings.temperature;
        if (maxHistoryInput) maxHistoryInput.value = settings.maxHistory;
        if (useStreamingInput) useStreamingInput.checked = settings.useStreaming;
        if (useThinkingInput) useThinkingInput.checked = settings.useThinking;
        if (llmModeInput) llmModeInput.value = settings.llmMode || 'openai';
        if (mcpServerLabelInput) mcpServerLabelInput.value = settings.mcpServerLabel || '';
        if (useVisionModeInput) useVisionModeInput.checked = settings.useVisionMode;
        if (useSidePanelInput) useSidePanelInput.checked = settings.useSidePanel;
        if (showSummarizeBtnInput) showSummarizeBtnInput.checked = settings.showSummarizeBtn;
        if (visionPromptInput) visionPromptInput.value = settings.visionPrompt;
        if (useTextEnhancementInput) useTextEnhancementInput.checked = settings.useTextEnhancement;
        if (textEnhancementPromptInput) textEnhancementPromptInput.value = settings.textEnhancementPrompt;
        if (systemRoleInput) systemRoleInput.value = settings.systemRole;
        if (userRequestInput) userRequestInput.value = settings.userRequest;
        if (summarizePromptInput) summarizePromptInput.value = settings.summarizePrompt;
        if (askWebpagePromptInput) askWebpagePromptInput.value = settings.askWebpagePrompt;
        if (uiLanguageInput) {
            uiLanguageInput.value = window.ci18n ? window.ci18n.currentLang : (settings.uiLanguage || 'auto');
        }

        if (statusText) statusText.textContent = i18n('settingsLoaded');

        updatePromptVisibility();
        updateModeVisibility();
    });

    // Handle immediate language change
    if (uiLanguageInput && window.ci18n) {
        uiLanguageInput.addEventListener('change', async () => {
            const newLang = uiLanguageInput.value;
            await window.ci18n.changeLanguage(newLang);
            // Re-render inputs that rely on translated defaults
            const defaults = getDefaultSettings();
            if (visionPromptInput && visionPromptInput.value === visionPromptInput.getAttribute('data-default-placeholder')) {
                visionPromptInput.value = defaults.visionPrompt;
            }
        });
    }

    // Save settings
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const defaults = getDefaultSettings();
            const settings = {
                serverAddress: serverAddressInput ? (serverAddressInput.value.trim() || defaults.serverAddress) : defaults.serverAddress,
                apiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
                modelKey: modelKeyInput ? modelKeyInput.value.trim() : '',
                maxTokens: maxTokensInput ? (parseInt(maxTokensInput.value) || defaults.maxTokens) : defaults.maxTokens,
                temperature: temperatureInput ? (parseFloat(temperatureInput.value) || defaults.temperature) : defaults.temperature,
                maxHistory: maxHistoryInput ? (parseInt(maxHistoryInput.value) || defaults.maxHistory) : defaults.maxHistory,
                useStreaming: useStreamingInput ? useStreamingInput.checked : defaults.useStreaming,
                useThinking: useThinkingInput ? useThinkingInput.checked : defaults.useThinking,
                llmMode: llmModeInput ? llmModeInput.value : defaults.llmMode,
                mcpServerLabel: mcpServerLabelInput ? mcpServerLabelInput.value.trim() : defaults.mcpServerLabel,
                useVisionMode: useVisionModeInput ? useVisionModeInput.checked : defaults.useVisionMode,
                useSidePanel: useSidePanelInput ? useSidePanelInput.checked : defaults.useSidePanel,
                showSummarizeBtn: showSummarizeBtnInput ? showSummarizeBtnInput.checked : defaults.showSummarizeBtn,
                visionPrompt: visionPromptInput ? (visionPromptInput.value.trim() || defaults.visionPrompt) : defaults.visionPrompt,
                useTextEnhancement: useTextEnhancementInput ? useTextEnhancementInput.checked : defaults.useTextEnhancement,
                textEnhancementPrompt: textEnhancementPromptInput ? (textEnhancementPromptInput.value.trim() || defaults.textEnhancementPrompt) : defaults.textEnhancementPrompt,
                systemRole: systemRoleInput ? (systemRoleInput.value.trim() || defaults.systemRole) : defaults.systemRole,
                userRequest: userRequestInput ? (userRequestInput.value.trim() || defaults.userRequest) : defaults.userRequest,
                summarizePrompt: summarizePromptInput ? (summarizePromptInput.value.trim() || defaults.summarizePrompt) : defaults.summarizePrompt,
                askWebpagePrompt: askWebpagePromptInput ? (askWebpagePromptInput.value.trim() || defaults.askWebpagePrompt) : defaults.askWebpagePrompt,
                uiLanguage: uiLanguageInput ? uiLanguageInput.value : 'auto'
            };

            chrome.storage.sync.set(settings, async () => {
                if (window.ci18n && uiLanguageInput) {
                    await window.ci18n.changeLanguage(uiLanguageInput.value);
                }

                if (statusText) {
                    statusText.textContent = i18n('saved');
                    statusText.classList.add('saved');

                    setTimeout(() => {
                        statusText.textContent = i18n('settingsLoaded');
                        statusText.classList.remove('saved');
                    }, 2000);
                }
            });
        });
    }

    // Open chat window instantly from popup
    const openChatBtn = document.getElementById('openChatBtn');
    if (openChatBtn) {
        openChatBtn.addEventListener('click', () => {
            if (useSidePanelInput && useSidePanelInput.checked && chrome.sidePanel) {
                chrome.windows.getCurrent({ populate: false }, (win) => {
                    chrome.sidePanel.open({ windowId: win.id }).then(() => {
                        window.close();
                    }).catch(e => {
                        console.error('[Local AI Assistant] Failed to open side panel:', e);
                        // In case of error, send message to background to handle popup fallback
                        chrome.runtime.sendMessage({ action: 'openChatFromPopup' });
                        window.close();
                    });
                });
            } else {
                chrome.runtime.sendMessage({ action: 'openChatFromPopup' });
                window.close();
            }
        });
    }
});
