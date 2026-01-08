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
}

document.addEventListener('DOMContentLoaded', () => {
    // Apply translations
    applyI18n();

    const serverAddressInput = document.getElementById('serverAddress');
    const modelKeyInput = document.getElementById('modelKey');
    const maxTokensInput = document.getElementById('maxTokens');
    const temperatureInput = document.getElementById('temperature');
    const maxHistoryInput = document.getElementById('maxHistory');
    const useStreamingInput = document.getElementById('useStreaming');
    const useVisionModeInput = document.getElementById('useVisionMode');
    const visionPromptInput = document.getElementById('visionPrompt');
    const visionPromptContainer = document.getElementById('visionPromptContainer');
    const useTextEnhancementInput = document.getElementById('useTextEnhancement');
    const textEnhancementPromptInput = document.getElementById('textEnhancementPrompt');
    const enhancementPromptContainer = document.getElementById('enhancementPromptContainer');
    const systemRoleInput = document.getElementById('systemRole');
    const userRequestInput = document.getElementById('userRequest');
    const saveBtn = document.getElementById('saveBtn');
    const statusText = document.getElementById('statusText');

    // Toggle prompt visibility based on toggle states
    function updatePromptVisibility() {
        if (useVisionModeInput.checked) {
            visionPromptContainer.classList.add('visible');
        } else {
            visionPromptContainer.classList.remove('visible');
        }

        if (useTextEnhancementInput.checked) {
            enhancementPromptContainer.classList.add('visible');
        } else {
            enhancementPromptContainer.classList.remove('visible');
        }
    }

    useVisionModeInput.addEventListener('change', updatePromptVisibility);
    useTextEnhancementInput.addEventListener('change', updatePromptVisibility);

    // Load saved settings
    const defaults = getDefaultSettings();
    chrome.storage.sync.get(defaults, (settings) => {
        serverAddressInput.value = settings.serverAddress;
        modelKeyInput.value = settings.modelKey;
        maxTokensInput.value = settings.maxTokens;
        temperatureInput.value = settings.temperature;
        maxHistoryInput.value = settings.maxHistory;
        useStreamingInput.checked = settings.useStreaming;
        useVisionModeInput.checked = settings.useVisionMode;
        visionPromptInput.value = settings.visionPrompt;
        useTextEnhancementInput.checked = settings.useTextEnhancement;
        textEnhancementPromptInput.value = settings.textEnhancementPrompt;
        systemRoleInput.value = settings.systemRole;
        userRequestInput.value = settings.userRequest;
        statusText.textContent = i18n('settingsLoaded');

        updatePromptVisibility();
    });

    // Save settings
    saveBtn.addEventListener('click', () => {
        const defaults = getDefaultSettings();
        const settings = {
            serverAddress: serverAddressInput.value.trim() || defaults.serverAddress,
            modelKey: modelKeyInput.value.trim(),
            maxTokens: parseInt(maxTokensInput.value) || defaults.maxTokens,
            temperature: parseFloat(temperatureInput.value) || defaults.temperature,
            maxHistory: parseInt(maxHistoryInput.value) || defaults.maxHistory,
            useStreaming: useStreamingInput.checked,
            useVisionMode: useVisionModeInput.checked,
            visionPrompt: visionPromptInput.value.trim() || defaults.visionPrompt,
            useTextEnhancement: useTextEnhancementInput.checked,
            textEnhancementPrompt: textEnhancementPromptInput.value.trim() || defaults.textEnhancementPrompt,
            systemRole: systemRoleInput.value.trim() || defaults.systemRole,
            userRequest: userRequestInput.value.trim() || defaults.userRequest
        };

        chrome.storage.sync.set(settings, () => {
            statusText.textContent = i18n('saved');
            statusText.classList.add('saved');

            setTimeout(() => {
                statusText.textContent = i18n('settingsLoaded');
                statusText.classList.remove('saved');
            }, 2000);
        });
    });
});
