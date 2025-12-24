// reader.js - Reader window logic

(async function () {
    // DOM Elements
    const siteName = document.getElementById("siteName");
    const articleTitle = document.getElementById("articleTitle");
    const articleMeta = document.getElementById("articleMeta");
    const articleBody = document.getElementById("articleBody");
    const readerContent = document.querySelector(".reader-content");
    const zoomOut = document.getElementById("zoomOut");
    const zoomIn = document.getElementById("zoomIn");
    const fontToggle = document.getElementById("fontToggle");
    const themeToggle = document.getElementById("themeToggle");
    const fullscreenToggle = document.getElementById("fullscreenToggle");
    const savePdf = document.getElementById("savePdf");

    // Advanced Settings Modal Elements
    const advSettings = document.getElementById("advSettings");
    const advModal = document.getElementById("advModal");
    const customFontInput = document.getElementById("customFont");
    const lineHeightInput = document.getElementById("lineHeight");
    const lineHeightDefault = document.getElementById("lineHeightDefault");
    const advReset = document.getElementById("advReset");
    const advSave = document.getElementById("advSave");

    // State
    let currentFont = localStorage.getItem("articleView_font") || "sans";
    let currentTheme = localStorage.getItem("articleView_theme") || "auto";
    let currentZoom = parseFloat(localStorage.getItem("articleView_zoom") || "1");
    let customFontName = localStorage.getItem("articleView_customFont") || "";
    let lineHeight = localStorage.getItem("articleView_lineHeight") || "";

    // Defaults
    const DEFAULT_LINE_HEIGHT = "1.8";

    // Theme order: light -> dark -> auto -> light ...
    const themeOrder = ["light", "dark", "auto"];
    const themeLabels = { light: "Light", dark: "Dark", auto: "Auto" };

    // Zoom limits
    const ZOOM_MIN = 0.6;
    const ZOOM_MAX = 1.6;
    const ZOOM_STEP = 0.1;

    // Initialize
    async function init() {
        // Load article data from storage
        const data = await chrome.storage.session.get("articleData");
        const article = data?.articleData;

        if (!article || !article.success) {
            articleBody.innerHTML = "<p>Could not load article content.</p>";
            return;
        }

        // Set content
        siteName.textContent = article.siteName || "";
        articleTitle.textContent = article.title || "Untitled";
        articleMeta.innerHTML = `<a href="${article.url}" target="_blank">${article.url}</a>`;
        articleBody.innerHTML = article.content || "";

        // Apply saved preferences
        applyFont(currentFont);
        applyTheme(currentTheme);
        applyZoom(currentZoom);
        applyAdvancedSettings();
    }

    // Zoom controls - scales entire article area like Ctrl+/-
    function applyZoom(scale) {
        currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
        readerContent.style.transform = `scale(${currentZoom})`;
        readerContent.style.transformOrigin = "top center";
        localStorage.setItem("articleView_zoom", currentZoom.toString());
    }

    zoomOut.addEventListener("click", () => {
        applyZoom(currentZoom - ZOOM_STEP);
    });

    zoomIn.addEventListener("click", () => {
        applyZoom(currentZoom + ZOOM_STEP);
    });

    // Font toggle
    function applyFont(font) {
        currentFont = font;
        document.body.classList.remove("font-serif", "font-sans");
        document.body.classList.add(`font-${font}`);
        fontToggle.querySelector(".btn-label").textContent = font === "serif" ? "Serif" : "Sans";
        localStorage.setItem("articleView_font", font);
    }

    fontToggle.addEventListener("click", () => {
        const nextFont = currentFont === "sans" ? "serif" : "sans";
        applyFont(nextFont);
    });

    // Theme toggle
    function applyTheme(theme) {
        currentTheme = theme;
        document.body.classList.remove("theme-light", "theme-dark", "theme-auto");
        document.body.classList.add(`theme-${theme}`);
        themeToggle.querySelector(".btn-label").textContent = themeLabels[theme];
        localStorage.setItem("articleView_theme", theme);
    }

    themeToggle.addEventListener("click", () => {
        const currentIndex = themeOrder.indexOf(currentTheme);
        const nextIndex = (currentIndex + 1) % themeOrder.length;
        applyTheme(themeOrder[nextIndex]);
    });

    // Fullscreen toggle
    function updateFullscreenButton() {
        const isFullscreen = !!document.fullscreenElement;
        fullscreenToggle.title = isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen";
    }

    fullscreenToggle.addEventListener("click", async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch (e) {
            console.error("Fullscreen error:", e);
        }
    });

    document.addEventListener("fullscreenchange", updateFullscreenButton);

    // Save as PDF
    savePdf.addEventListener("click", () => {
        window.print();
    });

    // Advanced Settings
    function applyAdvancedSettings() {
        // Apply custom font
        if (customFontName) {
            readerContent.style.fontFamily = customFontName;
        } else {
            readerContent.style.fontFamily = "";
        }

        // Apply line height
        if (lineHeight) {
            articleBody.style.lineHeight = lineHeight + "em";
        } else {
            articleBody.style.lineHeight = "";
        }
    }

    // Open modal
    advSettings.addEventListener("click", () => {
        customFontInput.value = customFontName;
        lineHeightInput.value = lineHeight || "";
        advModal.style.display = "flex";
    });

    // Close modal when clicking overlay
    advModal.addEventListener("click", (e) => {
        if (e.target === advModal) {
            advModal.style.display = "none";
        }
    });

    // Line height default button
    lineHeightDefault.addEventListener("click", () => {
        lineHeightInput.value = DEFAULT_LINE_HEIGHT;
    });

    // Reset button
    advReset.addEventListener("click", () => {
        customFontInput.value = "";
        lineHeightInput.value = "";
        customFontName = "";
        lineHeight = "";
        localStorage.removeItem("articleView_customFont");
        localStorage.removeItem("articleView_lineHeight");
        applyAdvancedSettings();
        advModal.style.display = "none";
    });

    // Save button
    advSave.addEventListener("click", () => {
        customFontName = customFontInput.value.trim();
        lineHeight = lineHeightInput.value.trim();

        if (customFontName) {
            localStorage.setItem("articleView_customFont", customFontName);
        } else {
            localStorage.removeItem("articleView_customFont");
        }

        if (lineHeight) {
            localStorage.setItem("articleView_lineHeight", lineHeight);
        } else {
            localStorage.removeItem("articleView_lineHeight");
        }

        applyAdvancedSettings();
        advModal.style.display = "none";
    });

    // Initialize
    init();
})();
