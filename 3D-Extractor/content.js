// content.js - Injects JSZip and WebGL hook scripts into the main page context

console.log("[3D Extractor] Content script loaded.");

// Inject JSZip and WebGL hooks sequentially to ensure proper dependency order
const jszipScript = document.createElement('script');
jszipScript.src = chrome.runtime.getURL('libs/jszip.min.js');
jszipScript.onload = () => {
    const hookScript = document.createElement('script');
    hookScript.src = chrome.runtime.getURL('webgl_hook.js');
    hookScript.onload = () => {
        hookScript.remove();
    };
    (document.head || document.documentElement).appendChild(hookScript);
    jszipScript.remove();
};
(document.head || document.documentElement).appendChild(jszipScript);

// Listen for messages from the popup/background to toggle UI or trigger capture
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggleUI") {
        window.postMessage({ type: "3D_EXTRACTOR_TOGGLE_UI" }, "*");
        sendResponse({ status: "ok" });
    } else if (message.action === "startCapture") {
        window.postMessage({ type: "3D_EXTRACTOR_START_CAPTURE" }, "*");
        sendResponse({ status: "ok" });
    } else if (message.action === "stopCapture") {
        window.postMessage({ type: "3D_EXTRACTOR_STOP_CAPTURE" }, "*");
        sendResponse({ status: "ok" });
    }
});
