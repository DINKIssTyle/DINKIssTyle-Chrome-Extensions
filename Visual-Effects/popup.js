// popup.js - Visual Effects settings popup

document.addEventListener('DOMContentLoaded', async () => {
    // Elements
    const enableToggle = document.getElementById('enableToggle');
    const effectSelect = document.getElementById('effectSelect');
    const directionSelect = document.getElementById('directionSelect');
    const directionGroup = document.getElementById('directionGroup');
    const durationRange = document.getElementById('durationRange');
    const durationValue = document.getElementById('durationValue');
    const previewBtn = document.getElementById('previewBtn');
    const previewBox = document.getElementById('previewBox');
    const settingsSection = document.querySelector('.settings-section');
    const previewSection = document.querySelector('.preview-section');

    // Default settings
    const DEFAULT_SETTINGS = {
        enabled: true,
        effect: 'slide',
        duration: 400,
        direction: 'left'
    };

    // Load current settings
    let settings = DEFAULT_SETTINGS;
    try {
        const result = await chrome.storage.sync.get('visualEffects');
        if (result.visualEffects) {
            settings = { ...DEFAULT_SETTINGS, ...result.visualEffects };
        }
    } catch (e) {
        console.log('Using default settings');
    }

    // Apply settings to UI
    function applySettingsToUI() {
        enableToggle.checked = settings.enabled;
        effectSelect.value = settings.effect;
        directionSelect.value = settings.direction;
        durationRange.value = settings.duration;
        durationValue.textContent = settings.duration;

        // Toggle sections based on enabled state
        settingsSection.classList.toggle('disabled', !settings.enabled);
        previewSection.classList.toggle('disabled', !settings.enabled);

        // Show/hide direction based on effect type
        updateDirectionVisibility();
    }

    // Update direction visibility based on effect
    function updateDirectionVisibility() {
        const effectsWithDirection = ['slide'];
        directionGroup.style.display = effectsWithDirection.includes(settings.effect) ? 'block' : 'none';
    }

    // Save settings
    async function saveSettings() {
        try {
            await chrome.storage.sync.set({ visualEffects: settings });
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    }

    // Event listeners
    enableToggle.addEventListener('change', () => {
        settings.enabled = enableToggle.checked;
        settingsSection.classList.toggle('disabled', !settings.enabled);
        previewSection.classList.toggle('disabled', !settings.enabled);
        saveSettings();
    });

    effectSelect.addEventListener('change', () => {
        settings.effect = effectSelect.value;
        updateDirectionVisibility();
        saveSettings();
    });

    directionSelect.addEventListener('change', () => {
        settings.direction = directionSelect.value;
        saveSettings();
    });

    durationRange.addEventListener('input', () => {
        settings.duration = parseInt(durationRange.value);
        durationValue.textContent = settings.duration;
    });

    durationRange.addEventListener('change', () => {
        saveSettings();
    });

    // Preview animation
    previewBtn.addEventListener('click', () => {
        const content = previewBox.querySelector('.preview-content');
        const effect = settings.effect;
        const duration = settings.duration;

        // Reset
        content.className = 'preview-content';
        content.style.animationDuration = `${duration}ms`;

        // Get animation classes
        let outClass = '';
        let inClass = '';

        switch (effect) {
            case 'slide':
                outClass = 'slide-out-left';
                inClass = 'slide-in-left';
                break;
            case 'fade':
                outClass = 'fade-out';
                inClass = 'fade-in';
                break;
            case 'curl':
                outClass = 'curl-out';
                inClass = 'curl-in';
                break;
            case 'flip':
                outClass = 'flip-out';
                inClass = 'flip-in';
                break;
            case 'zoom':
                outClass = 'zoom-out';
                inClass = 'zoom-in';
                break;
        }

        // Play out animation
        requestAnimationFrame(() => {
            content.classList.add(outClass);

            setTimeout(() => {
                content.className = 'preview-content';
                requestAnimationFrame(() => {
                    content.classList.add(inClass);
                });
            }, duration);
        });
    });

    // Initialize UI
    applySettingsToUI();
});
