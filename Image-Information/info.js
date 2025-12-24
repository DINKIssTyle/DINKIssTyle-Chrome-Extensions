// info.js - Popup window logic for displaying image information

(async function () {
    // DOM Elements
    const previewImage = document.getElementById("previewImage");
    const fileName = document.getElementById("fileName");
    const fileType = document.getElementById("fileType");
    const fileSize = document.getElementById("fileSize");
    const imageDimensions = document.getElementById("imageDimensions");
    const altText = document.getElementById("altText");
    const imageUrl = document.getElementById("imageUrl");
    const openNewTabBtn = document.getElementById("openNewTab");
    const saveImageBtn = document.getElementById("saveImage");

    let imageData = null;

    // Get image data from storage
    async function getImageData() {
        let hit = null;
        if (chrome.storage?.session) {
            const data = await chrome.storage.session.get("lastImageHit");
            hit = data?.lastImageHit || null;
        }
        if (!hit && chrome.storage?.local) {
            const data = await chrome.storage.local.get("lastImageHit");
            hit = data?.lastImageHit || null;
        }
        return hit;
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    // Get MIME type description with raw MIME type
    function getMimeTypeDescription(mimeType) {
        const types = {
            "image/jpeg": "JPEG",
            "image/jpg": "JPEG",
            "image/png": "PNG",
            "image/gif": "GIF",
            "image/webp": "WebP",
            "image/svg+xml": "SVG",
            "image/bmp": "BMP",
            "image/ico": "ICO",
            "image/x-icon": "ICO",
            "image/avif": "AVIF",
            "image/tiff": "TIFF"
        };
        const description = types[mimeType] || "Unknown";
        return mimeType ? `${description} (${mimeType})` : "Unknown";
    }

    // Extract filename from URL
    function extractFilename(url) {
        try {
            const u = new URL(url);
            const path = u.pathname.split("/").filter(Boolean).pop() || "image";
            const noQuery = path.split("?")[0].split("#")[0];
            return decodeURIComponent(noQuery) || "image";
        } catch {
            return "image";
        }
    }

    // Fetch image metadata (size, MIME type)
    async function fetchImageMetadata(url) {
        try {
            const response = await fetch(url, { method: "HEAD" });
            const contentLength = response.headers.get("content-length");
            const contentType = response.headers.get("content-type");
            return {
                size: contentLength ? parseInt(contentLength, 10) : null,
                mimeType: contentType ? contentType.split(";")[0].trim() : null
            };
        } catch {
            // HEAD failed, try GET with range
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                return {
                    size: blob.size,
                    mimeType: blob.type || null
                };
            } catch {
                return { size: null, mimeType: null };
            }
        }
    }

    // Get actual image dimensions
    function getImageDimensions(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ width: null, height: null });
            img.src = url;
        });
    }

    // Initialize and display image info
    async function init() {
        imageData = await getImageData();

        if (!imageData || !imageData.url) {
            fileName.textContent = "No image found";
            return;
        }

        const url = imageData.url;

        // Set preview image
        previewImage.src = url;
        previewImage.alt = imageData.alt || "Image Preview";

        // Set filename
        fileName.textContent = extractFilename(url);

        // Set alt text
        const altOrTitle = imageData.alt || imageData.title || "";
        altText.textContent = altOrTitle || "(None)";

        // Set URL
        imageUrl.textContent = url;

        // Fetch metadata
        const metadata = await fetchImageMetadata(url);

        // Set file type
        fileType.textContent = getMimeTypeDescription(metadata.mimeType);

        // Set file size
        fileSize.textContent = metadata.size ? formatFileSize(metadata.size) : "(Unknown)";

        // Get dimensions
        let dimensions = { width: imageData.naturalWidth, height: imageData.naturalHeight };
        if (!dimensions.width || !dimensions.height) {
            dimensions = await getImageDimensions(url);
        }
        imageDimensions.textContent = dimensions.width && dimensions.height
            ? `${dimensions.width} × ${dimensions.height} px`
            : "(Unknown)";
    }

    // Button handlers
    openNewTabBtn.addEventListener("click", () => {
        if (imageData?.url) {
            chrome.tabs.create({ url: imageData.url });
        }
    });

    saveImageBtn.addEventListener("click", async () => {
        if (!imageData?.url) return;

        try {
            const filename = extractFilename(imageData.url);
            await chrome.downloads.download({
                url: imageData.url,
                filename: filename,
                saveAs: true
            });
        } catch (e) {
            console.error("Download failed:", e);
        }
    });

    // Initialize
    init();
})();
