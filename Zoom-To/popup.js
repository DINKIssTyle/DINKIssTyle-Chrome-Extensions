document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggleZoom');
    const statusText = document.getElementById('statusText');

    // Load saved state (default true)
    chrome.storage.local.get(['zoomToEnabled'], (result) => {
        const isEnabled = result.zoomToEnabled !== false; // Default to true if undefined
        toggle.checked = isEnabled;
        updateUI(isEnabled);
    });

    // Save on change
    toggle.addEventListener('change', () => {
        const isEnabled = toggle.checked;
        chrome.storage.local.set({ zoomToEnabled: isEnabled }, () => {
            updateUI(isEnabled);
        });
    });

    function updateUI(isEnabled) {
        statusText.textContent = isEnabled ? 'Active' : 'Disabled';
        statusText.style.color = isEnabled ? '#4CAF50' : '#888';
        statusText.style.backgroundColor = isEnabled ? 'rgba(76, 175, 80, 0.1)' : '#2a2a2a';
    }
});
