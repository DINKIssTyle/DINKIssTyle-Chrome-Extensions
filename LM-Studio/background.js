/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
*/

const MENU_ID = 'lm-studio-process';

const DEFAULT_SETTINGS = {
    serverAddress: 'localhost:1234',
    maxTokens: 2048,
    temperature: 0.7,
    maxHistory: 10,
    useStreaming: false,
    systemRole: 'You are an expert at processing web articles, posts, and other content.',
    userRequest: 'Summarize the following text in Korean:'
};

chrome.runtime.onInstalled.addListener(() => {
    // Allow content scripts to write to session storage
    if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
        chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    }

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_ID,
            title: 'Process with LM Studio',
            contexts: ['selection']
        });
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.selectionText) return;

    try {
        // Store the selected text
        await chrome.storage.session.set({
            selectedText: info.selectionText,
            isNewConversation: true
        });

        // Open chat window centered on screen
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
    } catch (e) {
        console.error('[LM Studio] Error:', e);
    }
});
