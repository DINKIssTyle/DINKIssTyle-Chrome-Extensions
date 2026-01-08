/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

const DEFAULT_SETTINGS = {
    serverAddress: 'localhost:1234',
    maxTokens: 2048,
    temperature: 0.7,
    maxHistory: 10,
    useStreaming: false,
    systemRole: 'You are an expert at processing web articles, posts, and other content.',
    userRequest: 'Summarize the following text in Korean:'
};

document.addEventListener('DOMContentLoaded', () => {
    const serverAddressInput = document.getElementById('serverAddress');
    const maxTokensInput = document.getElementById('maxTokens');
    const temperatureInput = document.getElementById('temperature');
    const maxHistoryInput = document.getElementById('maxHistory');
    const useStreamingInput = document.getElementById('useStreaming');
    const systemRoleInput = document.getElementById('systemRole');
    const userRequestInput = document.getElementById('userRequest');
    const saveBtn = document.getElementById('saveBtn');
    const statusText = document.getElementById('statusText');

    // Load saved settings
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        serverAddressInput.value = settings.serverAddress;
        maxTokensInput.value = settings.maxTokens;
        temperatureInput.value = settings.temperature;
        maxHistoryInput.value = settings.maxHistory;
        useStreamingInput.checked = settings.useStreaming;
        systemRoleInput.value = settings.systemRole;
        userRequestInput.value = settings.userRequest;
        statusText.textContent = 'Settings loaded';
    });

    // Save settings
    saveBtn.addEventListener('click', () => {
        const settings = {
            serverAddress: serverAddressInput.value.trim() || DEFAULT_SETTINGS.serverAddress,
            maxTokens: parseInt(maxTokensInput.value) || DEFAULT_SETTINGS.maxTokens,
            temperature: parseFloat(temperatureInput.value) || DEFAULT_SETTINGS.temperature,
            maxHistory: parseInt(maxHistoryInput.value) || DEFAULT_SETTINGS.maxHistory,
            useStreaming: useStreamingInput.checked,
            systemRole: systemRoleInput.value.trim() || DEFAULT_SETTINGS.systemRole,
            userRequest: userRequestInput.value.trim() || DEFAULT_SETTINGS.userRequest
        };

        chrome.storage.sync.set(settings, () => {
            statusText.textContent = 'Saved!';
            statusText.classList.add('saved');

            setTimeout(() => {
                statusText.textContent = 'Settings loaded';
                statusText.classList.remove('saved');
            }, 2000);
        });
    });
});
