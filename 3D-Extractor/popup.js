// popup.js - Handles communication from the popup dashboard to the active webpage

document.getElementById('toggle-ui-btn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "toggleUI" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Could not toggle UI in tab: ", chrome.runtime.lastError.message);
                    alert("Please reload the page first to allow the 3D Extractor to initialize on this tab!");
                }
            });
        }
    });
});
