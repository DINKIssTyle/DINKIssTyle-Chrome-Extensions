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

    // All available effects for random selection
    const ALL_EFFECTS = [
        'slide', 'fade', 'zoom', 'push',
        'flip', 'curl', 'cube', 'rotate', 'swing', 'fold', 'cards',
        'blur', 'shrink', 'newspaper', 'glitch', 'bounce', 'iris', 'flash', 'morph', 'split'
    ];

    // Get a random effect
    function getRandomEffect() {
        return ALL_EFFECTS[Math.floor(Math.random() * ALL_EFFECTS.length)];
    }

    // Update direction visibility based on effect
    function updateDirectionVisibility() {
        const effectsWithDirection = ['slide', 'push', 'curl'];
        // Hide direction for 'random' since it will change randomly
        if (settings.effect === 'random') {
            directionGroup.style.display = 'none';
        } else {
            directionGroup.style.display = effectsWithDirection.includes(settings.effect) ? 'block' : 'none';
        }
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
        // Use random effect if 'random' is selected
        const effect = settings.effect === 'random' ? getRandomEffect() : settings.effect;
        const duration = settings.duration;

        // Reset
        content.className = 'preview-content';
        content.style.animationDuration = `${duration}ms`;

        // Animation mapping for all effects
        const animations = {
            slide: ['slide-out-left', 'slide-in-left'],
            fade: ['fade-out', 'fade-in'],
            curl: ['curl-out', 'curl-in'],
            flip: ['flip-out', 'flip-in'],
            zoom: ['zoom-out', 'zoom-in'],
            push: ['push-out', 'push-in'],
            rotate: ['rotate-out', 'rotate-in'],
            swing: ['swing-out', 'swing-in'],
            blur: ['blur-out', 'blur-in'],
            shrink: ['shrink-out', 'shrink-in'],
            newspaper: ['newspaper-out', 'newspaper-in'],
            cube: ['cube-out', 'cube-in'],
            glitch: ['glitch-out', 'glitch-in'],
            bounce: ['bounce-out', 'bounce-in'],
            cards: ['cards-out', 'cards-in'],
            iris: ['iris-out', 'iris-in'],
            flash: ['flash-out', 'flash-in'],
            fold: ['fold-out', 'fold-in'],
            morph: ['morph-out', 'morph-in'],
            split: ['split-out', 'split-in']
        };

        const [outClass, inClass] = animations[effect] || ['fade-out', 'fade-in'];

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

