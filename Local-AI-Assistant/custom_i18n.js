/*
    Created by DINKIssTyle on 2026.
    Copyright (C) 2026 DINKI'ssTyle. All rights reserved.

    Custom i18n handler to allow manual language overrides (ignoring the browser default).
*/

class CustomI18n {
    constructor() {
        this.messages = {};
        this.currentLang = 'auto'; // 'auto', 'en', 'ko'
        this.isLoaded = false;
        this.loadPromise = null;
    }

    async init() {
        if (this.loadPromise) return this.loadPromise;

        this.loadPromise = new Promise(async (resolve) => {
            const settings = await chrome.storage.sync.get({ uiLanguage: 'auto' });
            this.currentLang = settings.uiLanguage;
            await this.loadMessages(this.currentLang);
            this.isLoaded = true;
            resolve();
        });

        return this.loadPromise;
    }

    async loadMessages(langCode) {
        let fetchLang = langCode;

        if (langCode === 'auto') {
            // Determine browser language (usually "en-US", "ko", etc.)
            const browserLang = chrome.i18n.getUILanguage();
            fetchLang = browserLang.startsWith('ko') ? 'ko' : 'en';
        }

        try {
            const response = await fetch(chrome.runtime.getURL(`_locales/${fetchLang}/messages.json`));
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            this.messages = await response.json();
        } catch (error) {
            console.error(`[CustomI18n] Failed to load messages for ${fetchLang}, falling back to English.`, error);
            try {
                // Fallback to English if loading fails
                if (fetchLang !== 'en') {
                    const fallbackResponse = await fetch(chrome.runtime.getURL(`_locales/en/messages.json`));
                    this.messages = await fallbackResponse.json();
                }
            } catch (fallbackError) {
                console.error("[CustomI18n] Failed to load fallback messages.", fallbackError);
                this.messages = {};
            }
        }
    }

    getMessage(key, substitutions = null) {
        if (!this.messages[key]) {
            // Fallback to Chrome's native i18n if key is missing in our custom loaded JSON
            return chrome.i18n.getMessage(key, substitutions) || '';
        }

        let message = this.messages[key].message;

        if (substitutions) {
            const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
            subs.forEach((sub, index) => {
                // Replace $1, $2, etc. (Chrome i18n format)
                message = message.replace(new RegExp(`\\$${index + 1}`, 'g'), sub);
            });
        }

        return message;
    }

    applyToDOM(rootElement = document) {
        // Apply text content translations
        rootElement.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const message = this.getMessage(key);
            if (message) {
                element.textContent = message;
            }
        });

        // Apply placeholder translations
        rootElement.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const message = this.getMessage(key);
            if (message) {
                element.placeholder = message;
            }
        });

        // Apply title translations
        rootElement.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const message = this.getMessage(key);
            if (message) {
                element.title = message;
            }
        });
    }

    async changeLanguage(langCode) {
        if (this.currentLang === langCode) return;

        this.currentLang = langCode;
        await chrome.storage.sync.set({ uiLanguage: langCode });
        await this.loadMessages(langCode);
        this.applyToDOM();
    }
}

// Global instance (works in both window and service worker)
globalThis.ci18n = new CustomI18n();
