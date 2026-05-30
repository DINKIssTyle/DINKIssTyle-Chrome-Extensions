// webgl_hook.js - Core interceptor script that overrides WebGL contexts to capture meshes and textures

(function() {
    console.log("[3D Extractor] WebGL Hook script initialized in page context.");

    // Global states
    window._3dExtractorCapturing = false;
    window._3dExtractorCapturedMeshes = [];
    window._3dExtractorCapturedTextures = new Set();
    window._3dExtractorFlipY = true;

    // Keep track of all active contexts
    const activeContexts = new Set();

    // Helper: Get size of WebGL types
    function getTypeSize(type) {
        switch (type) {
            case 5120: // BYTE
            case 5121: // UNSIGNED_BYTE
                return 1;
            case 5122: // SHORT
            case 5123: // UNSIGNED_SHORT
                return 2;
            case 5124: // INT
            case 5125: // UNSIGNED_INT
            case 5126: // FLOAT
                return 4;
            default:
                return 4;
        }
    }

    // Helper: Convert WebGL Texture to PNG Data URL
    function getTextureAsPNG(texture) {
        if (!texture || (!texture._source && !texture._pixels)) return null;
        
        try {
            const canvas = document.createElement('canvas');
            canvas.width = texture._width || 256;
            canvas.height = texture._height || 256;
            const ctx = canvas.getContext('2d');
            
            if (window._3dExtractorFlipY) {
                // In WebGL, textures are usually flipped relative to 2D canvas, so we flip it
                ctx.translate(0, canvas.height);
                ctx.scale(1, -1);
            }
            
            if (texture._source) {
                ctx.drawImage(texture._source, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/png');
            } else if (texture._pixels) {
                const imgData = ctx.createImageData(canvas.width, canvas.height);
                const data = imgData.data;
                const pixels = texture._pixels;
                
                // Copy pixels
                for (let i = 0; i < data.length; i++) {
                    data[i] = pixels[i] !== undefined ? pixels[i] : 255;
                }
                ctx.putImageData(imgData, 0, 0);
                
                if (window._3dExtractorFlipY) {
                    // Flipping pixel buffer textures is easier by drawing to a temp canvas and flipping
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.putImageData(imgData, 0, 0);
                    
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(tempCanvas, 0, 0);
                }
                
                return canvas.toDataURL('image/png');
            }
        } catch (e) {
            console.warn("[3D Extractor] Failed to extract texture:", e);
        }
        return null;
    }

    // Hook a WebGL/WebGL2 Context
    function hookWebGLContext(gl, type) {
        if (gl._isHooked) return;
        gl._isHooked = true;
        activeContexts.add(gl);
        console.log(`[3D Extractor] Hooked ${type} context on canvas:`, gl.canvas);

        // State trackers on context
        gl._currentArrayBuffer = null;
        gl._currentElementArrayBuffer = null;
        gl._attribs = [];
        gl._activeTextureUnit = 0;
        gl._boundTextures = [];

        // 1. Buffer Bindings
        const orgBindBuffer = gl.bindBuffer;
        gl.bindBuffer = function(target, buffer) {
            if (target === gl.ARRAY_BUFFER) {
                gl._currentArrayBuffer = buffer;
            } else if (target === gl.ELEMENT_ARRAY_BUFFER) {
                gl._currentElementArrayBuffer = buffer;
            }
            return orgBindBuffer.apply(this, arguments);
        };

        // 2. Buffer Data loading
        const orgBufferData = gl.bufferData;
        gl.bufferData = function(target, data, usage) {
            const buffer = target === gl.ARRAY_BUFFER ? gl._currentArrayBuffer : 
                          (target === gl.ELEMENT_ARRAY_BUFFER ? gl._currentElementArrayBuffer : null);
            if (buffer) {
                if (typeof data === 'number') {
                    buffer._data = new Uint8Array(data);
                } else if (data) {
                    const srcBuffer = data.buffer || data;
                    if (srcBuffer instanceof ArrayBuffer) {
                        buffer._data = new Uint8Array(srcBuffer.slice(0));
                    }
                }
            }
            return orgBufferData.apply(this, arguments);
        };

        const orgBufferSubData = gl.bufferSubData;
        gl.bufferSubData = function(target, dstByteOffset, srcData, srcOffset, length) {
            const buffer = target === gl.ARRAY_BUFFER ? gl._currentArrayBuffer : 
                          (target === gl.ELEMENT_ARRAY_BUFFER ? gl._currentElementArrayBuffer : null);
            if (buffer && buffer._data) {
                let dataToCopy = null;
                if (srcData instanceof ArrayBuffer) {
                    dataToCopy = new Uint8Array(srcData);
                } else if (srcData && srcData.buffer instanceof ArrayBuffer) {
                    dataToCopy = new Uint8Array(srcData.buffer, srcData.byteOffset, srcData.byteLength);
                }
                
                if (dataToCopy) {
                    for (let i = 0; i < dataToCopy.length; i++) {
                        if (dstByteOffset + i < buffer._data.length) {
                            buffer._data[dstByteOffset + i] = dataToCopy[i];
                        }
                    }
                }
            }
            return orgBufferSubData.apply(this, arguments);
        };

        // 3. Vertex Attributes Layouts
        const orgVertexAttribPointer = gl.vertexAttribPointer;
        gl.vertexAttribPointer = function(index, size, type, normalized, stride, offset) {
            gl._attribs[index] = {
                buffer: gl._currentArrayBuffer,
                size: size,
                type: type,
                normalized: normalized,
                stride: stride,
                offset: offset,
                enabled: gl._attribs[index] ? gl._attribs[index].enabled : false
            };
            return orgVertexAttribPointer.apply(this, arguments);
        };

        const orgEnableVertexAttribArray = gl.enableVertexAttribArray;
        gl.enableVertexAttribArray = function(index) {
            if (!gl._attribs[index]) gl._attribs[index] = {};
            gl._attribs[index].enabled = true;
            return orgEnableVertexAttribArray.apply(this, arguments);
        };

        const orgDisableVertexAttribArray = gl.disableVertexAttribArray;
        gl.disableVertexAttribArray = function(index) {
            if (!gl._attribs[index]) gl._attribs[index] = {};
            gl._attribs[index].enabled = false;
            return orgDisableVertexAttribArray.apply(this, arguments);
        };

        // 4. Texture tracking
        const orgActiveTexture = gl.activeTexture;
        gl.activeTexture = function(textureUnit) {
            gl._activeTextureUnit = textureUnit - gl.TEXTURE0;
            return orgActiveTexture.apply(this, arguments);
        };

        const orgBindTexture = gl.bindTexture;
        gl.bindTexture = function(target, texture) {
            if (target === gl.TEXTURE_2D) {
                if (!gl._boundTextures) gl._boundTextures = [];
                gl._boundTextures[gl._activeTextureUnit] = texture;
            }
            return orgBindTexture.apply(this, arguments);
        };

        const orgTexImage2D = gl.texImage2D;
        gl.texImage2D = function(target, level, internalformat, width, height, border, format, type, pixels) {
            if (target === gl.TEXTURE_2D) {
                const texture = gl._boundTextures ? gl._boundTextures[gl._activeTextureUnit] : null;
                if (texture) {
                    if (arguments.length === 6 || (arguments.length === 9 && (pixels instanceof HTMLImageElement || pixels instanceof HTMLCanvasElement || pixels instanceof ImageBitmap))) {
                        const source = arguments[5] || pixels;
                        texture._source = source;
                        texture._width = source.width || source.videoWidth;
                        texture._height = source.height || source.videoHeight;
                    } else {
                        texture._pixels = pixels ? new Uint8Array(pixels.buffer || pixels) : null;
                        texture._width = width;
                        texture._height = height;
                        texture._format = format;
                        texture._type = type;
                    }
                }
            }
            return orgTexImage2D.apply(this, arguments);
        };

        const orgTexSubImage2D = gl.texSubImage2D;
        gl.texSubImage2D = function(target, level, xoffset, yoffset, width, height, format, type, pixels) {
            if (target === gl.TEXTURE_2D) {
                const texture = gl._boundTextures ? gl._boundTextures[gl._activeTextureUnit] : null;
                if (texture) {
                    if (arguments.length === 7 || (arguments.length === 9 && (pixels instanceof HTMLImageElement || pixels instanceof HTMLCanvasElement || pixels instanceof ImageBitmap))) {
                        const source = arguments[6] || pixels;
                        texture._source = source;
                        texture._width = source.width;
                        texture._height = source.height;
                    } else {
                        texture._pixels = pixels ? new Uint8Array(pixels.buffer || pixels) : null;
                        if (width) texture._width = width;
                        if (height) texture._height = height;
                    }
                }
            }
            return orgTexSubImage2D.apply(this, arguments);
        };

        // 5. Draw Call Interception
        const orgDrawElements = gl.drawElements;
        gl.drawElements = function(mode, count, type, offset) {
            if (window._3dExtractorCapturing) {
                try { captureDrawCall(this, true, mode, count, type, offset); } catch(e) {}
            }
            return orgDrawElements.apply(this, arguments);
        };

        const orgDrawArrays = gl.drawArrays;
        gl.drawArrays = function(mode, first, count) {
            if (window._3dExtractorCapturing) {
                try { captureDrawCall(this, false, mode, count, 0, 0, first); } catch(e) {}
            }
            return orgDrawArrays.apply(this, arguments);
        };

        // Instanced draw call hooking
        if (gl.drawElementsInstanced) {
            const orgDrawElementsInstanced = gl.drawElementsInstanced;
            gl.drawElementsInstanced = function(mode, count, type, offset, instanceCount) {
                if (window._3dExtractorCapturing) {
                    try { captureDrawCall(this, true, mode, count, type, offset); } catch(e) {}
                }
                return orgDrawElementsInstanced.apply(this, arguments);
            };
        }

        if (gl.drawArraysInstanced) {
            const orgDrawArraysInstanced = gl.drawArraysInstanced;
            gl.drawArraysInstanced = function(mode, first, count, instanceCount) {
                if (window._3dExtractorCapturing) {
                    try { captureDrawCall(this, false, mode, count, 0, 0, first); } catch(e) {}
                }
                return orgDrawArraysInstanced.apply(this, arguments);
            };
        }
    }

    // Geometry Extractor from draw call
    function captureDrawCall(gl, isDrawElements, mode, count, type, offset, first = 0) {
        // Find shader attribute mappings
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        let posAttribIndex = -1;
        let uvAttribIndex = -1;
        let normalAttribIndex = -1;

        if (program) {
            const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
            for (let i = 0; i < numAttribs; ++i) {
                const info = gl.getActiveAttrib(program, i);
                if (!info) continue;
                const loc = gl.getAttribLocation(program, info.name);
                const name = info.name.toLowerCase();
                
                if (name.includes('position') || name.includes('pos') || name.includes('vertex') || name === 'coords' || name.includes('a_position')) {
                    posAttribIndex = loc;
                } else if (name.includes('uv') || name.includes('texcoord') || name.includes('coord') || name.includes('map') || name.includes('a_texcoord')) {
                    uvAttribIndex = loc;
                } else if (name.includes('normal') || name.includes('norm') || name.includes('a_normal')) {
                    normalAttribIndex = loc;
                }
            }
        }

        // Fallback for position attribute
        if (posAttribIndex === -1 && gl._attribs[0] && gl._attribs[0].enabled) {
            posAttribIndex = 0;
        }

        const posAttrib = gl._attribs[posAttribIndex];
        if (!posAttrib || !posAttrib.buffer || !posAttrib.buffer._data) return;

        const uvAttrib = uvAttribIndex !== -1 ? gl._attribs[uvAttribIndex] : null;
        const normalAttrib = normalAttribIndex !== -1 ? gl._attribs[normalAttribIndex] : null;

        // Collect indices
        const indices = [];
        if (isDrawElements) {
            const indexBuffer = gl._currentElementArrayBuffer;
            if (!indexBuffer || !indexBuffer._data) return;
            const view = new DataView(indexBuffer._data.buffer, indexBuffer._data.byteOffset, indexBuffer._data.byteLength);
            const typeSize = (type === gl.UNSIGNED_SHORT) ? 2 : ((type === gl.UNSIGNED_BYTE) ? 1 : 4);
            
            for (let i = 0; i < count; i++) {
                const bytePos = offset + i * typeSize;
                if (bytePos + typeSize <= indexBuffer._data.byteLength) {
                    let idx = 0;
                    if (type === gl.UNSIGNED_SHORT) {
                        idx = view.getUint16(bytePos, true);
                    } else if (type === gl.UNSIGNED_BYTE) {
                        idx = view.getUint8(bytePos);
                    } else if (type === gl.UNSIGNED_INT) {
                        idx = view.getUint32(bytePos, true);
                    }
                    indices.push(idx);
                }
            }
        } else {
            for (let i = 0; i < count; i++) {
                indices.push(first + i);
            }
        }

        if (indices.length === 0) return;

        // Read attribute helper
        function getAttribValue(attrib, idx) {
            if (!attrib || !attrib.buffer || !attrib.buffer._data) return null;
            const typeSize = getTypeSize(attrib.type);
            const stride = attrib.stride || (attrib.size * typeSize);
            const byteOffset = attrib.offset + idx * stride;
            const bufferData = attrib.buffer._data;
            
            if (byteOffset + attrib.size * typeSize > bufferData.byteLength) return null;
            
            const view = new DataView(bufferData.buffer, bufferData.byteOffset, bufferData.byteLength);
            const values = [];
            for (let i = 0; i < attrib.size; i++) {
                const valOffset = byteOffset + i * typeSize;
                let val = 0;
                if (attrib.type === 5126) { // FLOAT
                    val = view.getFloat32(valOffset, true);
                } else if (attrib.type === 5122) { // SHORT
                    val = view.getInt16(valOffset, true);
                } else if (attrib.type === 5123) { // UNSIGNED_SHORT
                    val = view.getUint16(valOffset, true);
                } else if (attrib.type === 5120) { // BYTE
                    val = view.getInt8(valOffset);
                } else if (attrib.type === 5121) { // UNSIGNED_BYTE
                    val = view.getUint8(valOffset);
                } else if (attrib.type === 5124) { // INT
                    val = view.getInt32(valOffset, true);
                } else if (attrib.type === 5125) { // UNSIGNED_INT
                    val = view.getUint32(valOffset, true);
                }
                values.push(val);
            }
            return values;
        }

        // Reconstruct vertex mapping
        const uniqueIndices = Array.from(new Set(indices));
        const indexMap = new Map();
        const vertices = [];
        const normals = [];
        const uvs = [];

        let localIdx = 1;
        uniqueIndices.forEach(idx => {
            const pos = getAttribValue(posAttrib, idx);
            if (pos) {
                // Standardize to 3D vertices
                vertices.push([pos[0] || 0, pos[1] || 0, pos[2] || 0]);
                indexMap.set(idx, localIdx++);

                if (uvAttrib) {
                    const uv = getAttribValue(uvAttrib, idx);
                    uvs.push(uv ? [uv[0], uv[1]] : [0, 0]);
                } else {
                    uvs.push([0, 0]);
                }

                if (normalAttrib) {
                    const norm = getAttribValue(normalAttrib, idx);
                    normals.push(norm ? [norm[0], norm[1], norm[2]] : [0, 0, 1]);
                } else {
                    normals.push([0, 0, 1]);
                }
            }
        });

        // Generate faces
        const faces = [];
        for (let i = 0; i < indices.length; i += 3) {
            const i1 = indexMap.get(indices[i]);
            const i2 = indexMap.get(indices[i+1]);
            const i3 = indexMap.get(indices[i+2]);
            if (i1 !== undefined && i2 !== undefined && i3 !== undefined) {
                faces.push([i1, i2, i3]);
            }
        }

        if (vertices.length === 0 || faces.length === 0) return;

        // Capture texture
        let meshTexturePNG = null;
        if (gl._boundTextures) {
            for (let t = 0; t < gl._boundTextures.length; t++) {
                const tex = gl._boundTextures[t];
                if (tex && (tex._source || tex._pixels)) {
                    meshTexturePNG = getTextureAsPNG(tex);
                    break;
                }
            }
        }

        const newMesh = {
            id: window._3dExtractorCapturedMeshes.length + 1,
            vertices,
            normals,
            uvs,
            faces,
            texturePNG: meshTexturePNG,
            vertexCount: vertices.length,
            faceCount: faces.length,
            timestamp: Date.now()
        };

        // De-duplicate
        if (!isDuplicateMesh(newMesh)) {
            window._3dExtractorCapturedMeshes.push(newMesh);
            updateDashboardUI();
        }
    }

    function isDuplicateMesh(newMesh) {
        for (const oldMesh of window._3dExtractorCapturedMeshes) {
            if (oldMesh.vertexCount === newMesh.vertexCount && oldMesh.faceCount === newMesh.faceCount) {
                let match = true;
                for (let i = 0; i < Math.min(15, newMesh.vertexCount); i++) {
                    if (Math.abs(oldMesh.vertices[i][0] - newMesh.vertices[i][0]) > 0.00001 ||
                        Math.abs(oldMesh.vertices[i][1] - newMesh.vertices[i][1]) > 0.00001 ||
                        Math.abs(oldMesh.vertices[i][2] - newMesh.vertices[i][2]) > 0.00001) {
                        match = false;
                        break;
                    }
                }
                if (match) return true;
            }
        }
        return false;
    }

    // Override canvas context methods
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, attributes) {
        const gl = originalGetContext.apply(this, arguments);
        if (gl && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
            try {
                hookWebGLContext(gl, type);
            } catch (e) {
                console.error("[3D Extractor] Error wrapping canvas context:", e);
            }
        }
        return gl;
    };

    // Override OffscreenCanvas if available
    if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype.getContext) {
        const originalOffscreenGetContext = OffscreenCanvas.prototype.getContext;
        OffscreenCanvas.prototype.getContext = function(type, attributes) {
            const gl = originalOffscreenGetContext.apply(this, arguments);
            if (gl && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
                try {
                    hookWebGLContext(gl, type);
                } catch (e) {
                    console.error("[3D Extractor] Error wrapping OffscreenCanvas context:", e);
                }
            }
            return gl;
        };
    }

    // ==========================================
    // PREMIUM OVERLAY DASHBOARD UI INJECTION
    // ==========================================
    let dashboardEl = null;
    let launcherEl = null;
    let selectedMesh = null;
    let previewCanvas = null;
    let previewCtx = null;
    let rotX = -0.5;
    let rotY = 0.5;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let activeTab = "meshes";

    function injectUI() {
        if (document.getElementById('extractor-ui-root')) return;

        // Load google fonts
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap';
        document.head.appendChild(link);

        // Root container
        const root = document.createElement('div');
        root.id = 'extractor-ui-root';
        document.body.appendChild(root);

        // Stylesheet
        const style = document.createElement('style');
        style.innerHTML = `
            #extractor-ui-root {
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                z-index: 999999;
                position: relative;
            }
            
            .extractor-launcher {
                position: fixed;
                bottom: 25px;
                right: 25px;
                width: 60px;
                height: 60px;
                border-radius: 30px;
                background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
                box-shadow: 0 8px 32px rgba(79, 172, 254, 0.4);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                border: 2px solid rgba(255, 255, 255, 0.2);
                z-index: 100000;
            }
            .extractor-launcher:hover {
                transform: scale(1.1) rotate(15deg);
                box-shadow: 0 12px 40px rgba(79, 172, 254, 0.6);
            }
            .extractor-launcher svg {
                width: 28px;
                height: 28px;
                fill: white;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            }

            .extractor-dashboard {
                position: fixed;
                top: 25px;
                right: 25px;
                width: 380px;
                height: 640px;
                background: rgba(13, 15, 24, 0.75);
                backdrop-filter: blur(24px) saturate(180%);
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
                color: #e2e8f0;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                transform: translateX(450px);
                transition: transform 0.5s cubic-bezier(0.075, 0.82, 0.165, 1);
                z-index: 99999;
            }
            .extractor-dashboard.visible {
                transform: translateX(0);
            }

            .dashboard-header {
                padding: 18px 24px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: rgba(255,255,255,0.02);
            }
            .dashboard-title {
                font-weight: 700;
                font-size: 18px;
                letter-spacing: 1px;
                background: linear-gradient(90deg, #00f2fe, #4facfe);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .pulse-dot {
                width: 8px;
                height: 8px;
                border-radius: 4px;
                background-color: #00f2fe;
                box-shadow: 0 0 8px #00f2fe;
            }
            .pulse-dot.capturing {
                background-color: #ff007f;
                box-shadow: 0 0 12px #ff007f;
                animation: pulse 1s infinite alternate;
            }
            @keyframes pulse {
                from { transform: scale(0.8); opacity: 0.5; }
                to { transform: scale(1.3); opacity: 1; }
            }
            .close-btn {
                background: transparent;
                border: none;
                color: #a0aec0;
                cursor: pointer;
                font-size: 20px;
                transition: color 0.2s;
            }
            .close-btn:hover {
                color: white;
            }

            .dashboard-body {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 20px;
                gap: 16px;
                overflow-y: auto;
            }

            .capture-panel {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 12px;
                padding: 16px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
            }
            .btn-capture {
                width: 100%;
                padding: 14px;
                border-radius: 10px;
                border: none;
                font-weight: 600;
                font-size: 15px;
                cursor: pointer;
                transition: all 0.3s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            }
            .btn-capture.idle {
                background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
                color: #0d0f18;
            }
            .btn-capture.idle:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(79, 172, 254, 0.4);
            }
            .btn-capture.capturing {
                background: linear-gradient(135deg, #ff007f 0%, #7f00ff 100%);
                color: white;
                animation: capt-pulse 1.5s infinite;
            }
            @keyframes capt-pulse {
                0% { box-shadow: 0 0 0 0 rgba(255, 0, 127, 0.4); }
                70% { box-shadow: 0 0 0 12px rgba(255, 0, 127, 0); }
                100% { box-shadow: 0 0 0 0 rgba(255, 0, 127, 0); }
            }

            .capture-status {
                font-size: 13px;
                color: #a0aec0;
                display: flex;
                justify-content: space-between;
                width: 100%;
            }

            .tab-header {
                display: flex;
                border-bottom: 1px solid rgba(255,255,255,0.05);
                gap: 16px;
            }
            .tab-btn {
                background: transparent;
                border: none;
                color: #a0aec0;
                padding: 8px 4px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                position: relative;
                transition: color 0.2s;
            }
            .tab-btn.active {
                color: #00f2fe;
            }
            .tab-btn.active::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 2px;
                background-color: #00f2fe;
                box-shadow: 0 0 8px #00f2fe;
            }

            .asset-list {
                flex: 1;
                border: 1px solid rgba(255, 255, 255, 0.05);
                background: rgba(0, 0, 0, 0.2);
                border-radius: 12px;
                overflow-y: auto;
                min-height: 140px;
                max-height: 200px;
            }
            .asset-item {
                padding: 10px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.02);
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                transition: background 0.2s;
                font-size: 13px;
            }
            .asset-item:hover {
                background: rgba(255,255,255,0.03);
            }
            .asset-item.selected {
                background: rgba(0, 242, 254, 0.08);
                border-left: 3px solid #00f2fe;
            }
            .asset-name {
                font-weight: 600;
            }
            .asset-info {
                color: #a0aec0;
                font-size: 11px;
            }

            .preview-container {
                height: 180px;
                background: rgba(0,0,0,0.4);
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.05);
                position: relative;
                overflow: hidden;
            }
            .preview-canvas {
                width: 100%;
                height: 100%;
                cursor: grab;
            }
            .preview-canvas:active {
                cursor: grabbing;
            }
            .preview-overlay {
                position: absolute;
                bottom: 8px;
                left: 8px;
                font-size: 10px;
                color: rgba(255,255,255,0.4);
                pointer-events: none;
            }

            .control-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 12px;
                color: #a0aec0;
            }
            .switch-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .switch {
                position: relative;
                display: inline-block;
                width: 34px;
                height: 20px;
            }
            .switch input { 
                opacity: 0;
                width: 0;
                height: 0;
            }
            .slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: rgba(255,255,255,0.1);
                transition: .4s;
                border-radius: 20px;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .slider:before {
                position: absolute;
                content: "";
                height: 14px; width: 14px;
                left: 2px; bottom: 2px;
                background-color: white;
                transition: .4s;
                border-radius: 50%;
            }
            input:checked + .slider {
                background-color: #00f2fe;
            }
            input:checked + .slider:before {
                transform: translateX(14px);
            }

            .action-buttons {
                display: flex;
                gap: 12px;
            }
            .btn-action {
                flex: 1;
                padding: 12px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.08);
                background: rgba(255,255,255,0.03);
                color: #e2e8f0;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .btn-action:hover:not(:disabled) {
                background: rgba(255,255,255,0.08);
                color: white;
                border-color: rgba(255,255,255,0.15);
            }
            .btn-action.primary {
                background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
                color: #0d0f18;
                border: none;
            }
            .btn-action.primary:hover:not(:disabled) {
                opacity: 0.9;
                box-shadow: 0 4px 12px rgba(79, 172, 254, 0.3);
            }
            .btn-action:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: #718096;
                font-size: 12px;
                text-align: center;
                gap: 8px;
                padding: 20px;
            }
        `;
        document.head.appendChild(style);

        // Create launcher
        launcherEl = document.createElement('div');
        launcherEl.className = 'extractor-launcher';
        launcherEl.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
        `;
        launcherEl.addEventListener('click', toggleDashboard);
        root.appendChild(launcherEl);

        // Create dashboard
        dashboardEl = document.createElement('div');
        dashboardEl.className = 'extractor-dashboard';
        dashboardEl.innerHTML = `
            <div class="dashboard-header">
                <div class="dashboard-title">
                    <div class="pulse-dot" id="header-pulse"></div>
                    3D EXTRACTOR
                </div>
                <button class="close-btn" id="close-dashboard-btn">&times;</button>
            </div>
            <div class="dashboard-body">
                <div class="capture-panel">
                    <button class="btn-capture idle" id="capture-toggle-btn">Start Capture</button>
                    <div class="capture-status">
                        <span id="capture-status-lbl">Status: Idle</span>
                        <span id="capture-count-lbl">Meshes: 0</span>
                    </div>
                </div>

                <div class="tab-header">
                    <button class="tab-btn active" id="tab-meshes-btn">Meshes</button>
                    <button class="tab-btn" id="tab-textures-btn">Textures</button>
                </div>

                <div class="asset-list" id="asset-list-box">
                    <div class="empty-state">
                        <span>No objects captured yet.</span>
                        <span style="font-size:10px;">Click Start Capture and interact with the page!</span>
                    </div>
                </div>

                <div class="control-row">
                    <div class="switch-container">
                        <label class="switch">
                            <input type="checkbox" id="flip-y-switch" checked>
                            <span class="slider"></span>
                        </label>
                        <span>Flip Texture Y</span>
                    </div>
                    <button class="btn-action" id="reset-captures-btn" style="padding: 4px 8px; flex: initial; font-size:11px;">Reset</button>
                </div>

                <div class="preview-container">
                    <canvas class="preview-canvas" id="mesh-preview-canvas"></canvas>
                    <div class="preview-overlay" id="preview-info-lbl">Select a mesh to preview</div>
                </div>

                <div class="action-buttons">
                    <button class="btn-action" id="export-selected-btn" disabled>Export Selected</button>
                    <button class="btn-action primary" id="export-all-btn" disabled>Export All</button>
                </div>
            </div>
        `;
        root.appendChild(dashboardEl);

        // Bind events
        document.getElementById('close-dashboard-btn').addEventListener('click', toggleDashboard);
        document.getElementById('capture-toggle-btn').addEventListener('click', toggleCapture);
        document.getElementById('reset-captures-btn').addEventListener('click', resetCaptures);
        
        const flipYSwitch = document.getElementById('flip-y-switch');
        flipYSwitch.addEventListener('change', () => {
            window._3dExtractorFlipY = flipYSwitch.checked;
            // Regenerate selected mesh preview texture if any
            if (selectedMesh) {
                selectedMesh.texturePNG = getTextureAsPNG(selectedMesh._texReference);
            }
        });

        document.getElementById('tab-meshes-btn').addEventListener('click', () => setTab('meshes'));
        document.getElementById('tab-textures-btn').addEventListener('click', () => setTab('textures'));

        document.getElementById('export-selected-btn').addEventListener('click', exportSelected);
        document.getElementById('export-all-btn').addEventListener('click', exportAll);

        // Drag/Rotate setup for preview canvas
        previewCanvas = document.getElementById('mesh-preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
        
        previewCanvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging || !selectedMesh) return;
            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;
            rotY += deltaX * 0.01;
            rotX += deltaY * 0.01;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            renderPreview();
        });

        // Resize handler for canvas
        const resizeObserver = new ResizeObserver(() => {
            previewCanvas.width = previewCanvas.clientWidth * window.devicePixelRatio;
            previewCanvas.height = previewCanvas.clientHeight * window.devicePixelRatio;
            renderPreview();
        });
        resizeObserver.observe(previewCanvas);
    }

    function toggleDashboard() {
        dashboardEl.classList.toggle('visible');
    }

    function toggleCapture() {
        const btn = document.getElementById('capture-toggle-btn');
        const dot = document.getElementById('header-pulse');
        const lbl = document.getElementById('capture-status-lbl');

        if (!window._3dExtractorCapturing) {
            window._3dExtractorCapturing = true;
            btn.textContent = "STOP CAPTURE";
            btn.className = "btn-capture capturing";
            dot.className = "pulse-dot capturing";
            lbl.textContent = "Status: Capturing...";
            console.log("[3D Extractor] Capturing started.");
        } else {
            window._3dExtractorCapturing = false;
            btn.textContent = "START CAPTURE";
            btn.className = "btn-capture idle";
            dot.className = "pulse-dot";
            lbl.textContent = "Status: Idle";
            console.log("[3D Extractor] Capturing stopped. Total captured:", window._3dExtractorCapturedMeshes.length);
            updateDashboardUI();
        }
    }

    function resetCaptures() {
        window._3dExtractorCapturedMeshes = [];
        selectedMesh = null;
        updateDashboardUI();
        renderPreview();
        console.log("[3D Extractor] Captured meshes cleared.");
    }

    function setTab(tab) {
        activeTab = tab;
        document.getElementById('tab-meshes-btn').className = tab === 'meshes' ? 'tab-btn active' : 'tab-btn';
        document.getElementById('tab-textures-btn').className = tab === 'textures' ? 'tab-btn active' : 'tab-btn';
        updateDashboardUI();
    }

    // Update list visual in UI
    function updateDashboardUI() {
        if (!dashboardEl) return;
        
        document.getElementById('capture-count-lbl').textContent = `Meshes: ${window._3dExtractorCapturedMeshes.length}`;

        const listContainer = document.getElementById('asset-list-box');
        listContainer.innerHTML = '';

        const activeList = window._3dExtractorCapturedMeshes;

        if (activeList.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <span>No objects captured yet.</span>
                    <span style="font-size:10px;">Click Start Capture and interact with the page!</span>
                </div>
            `;
            document.getElementById('export-selected-btn').disabled = true;
            document.getElementById('export-all-btn').disabled = true;
            return;
        }

        document.getElementById('export-all-btn').disabled = false;

        if (activeTab === 'meshes') {
            activeList.forEach(mesh => {
                const item = document.createElement('div');
                item.className = `asset-item ${selectedMesh && selectedMesh.id === mesh.id ? 'selected' : ''}`;
                item.innerHTML = `
                    <div>
                        <div class="asset-name">Mesh #${mesh.id}</div>
                        <div class="asset-info">V: ${mesh.vertexCount} | F: ${mesh.faceCount}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 6px;">
                        ${mesh.texturePNG ? '<span style="color:#00f2fe; font-size:10px; border:1px solid #00f2fe; border-radius:3px; padding:1px 3px;">Tex</span>' : ''}
                        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:#a0aec0;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                    </div>
                `;
                item.addEventListener('click', () => {
                    selectedMesh = mesh;
                    document.getElementById('export-selected-btn').disabled = false;
                    document.getElementById('preview-info-lbl').textContent = `Mesh #${mesh.id} Preview (Drag to rotate)`;
                    updateDashboardUI();
                    renderPreview();
                });
                listContainer.appendChild(item);
            });
        } else {
            // Textures tab
            const uniqueTextures = [];
            activeList.forEach(mesh => {
                if (mesh.texturePNG && !uniqueTextures.some(t => t.png === mesh.texturePNG)) {
                    uniqueTextures.push({ id: mesh.id, png: mesh.texturePNG });
                }
            });

            if (uniqueTextures.length === 0) {
                listContainer.innerHTML = `
                    <div class="empty-state">
                        <span>No textures captured.</span>
                    </div>
                `;
                return;
            }

            uniqueTextures.forEach((tex, idx) => {
                const item = document.createElement('div');
                item.className = 'asset-item';
                item.style.cursor = 'default';
                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap: 12px;">
                        <img src="${tex.png}" style="width:40px; height:40px; border-radius:6px; object-fit:cover; border:1px solid rgba(255,255,255,0.1); background:#222;"/>
                        <div>
                            <div class="asset-name">Texture #${idx + 1}</div>
                            <div class="asset-info">From Mesh #${tex.id}</div>
                        </div>
                    </div>
                    <button class="btn-action" style="flex:initial; padding:6px 10px; font-size:11px;" id="dl-tex-btn-${idx}">Download</button>
                `;
                listContainer.appendChild(item);
                
                document.getElementById(`dl-tex-btn-${idx}`).addEventListener('click', () => {
                    const a = document.createElement('a');
                    a.href = tex.png;
                    a.download = `extracted_texture_${idx + 1}.png`;
                    a.click();
                });
            });
        }
    }

    // Wireframe 3D Renderer in 2D Canvas
    function renderPreview() {
        if (!previewCanvas || !previewCtx) return;
        
        const w = previewCanvas.width;
        const h = previewCanvas.height;
        previewCtx.clearRect(0, 0, w, h);

        if (!selectedMesh) {
            // Draw empty state
            previewCtx.fillStyle = "rgba(255,255,255,0.15)";
            previewCtx.font = "14px Outfit";
            previewCtx.textAlign = "center";
            previewCtx.textBaseline = "middle";
            previewCtx.fillText("Select a mesh to preview", w/2, h/2);
            return;
        }

        const vertices = selectedMesh.vertices;
        const faces = selectedMesh.faces;

        // Compute Bounding Box & Center
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        vertices.forEach(v => {
            if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
            if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
            if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
        });

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;

        const sizeX = maxX - minX;
        const sizeY = maxY - minY;
        const sizeZ = maxZ - minZ;
        const maxDims = Math.max(sizeX, sizeY, sizeZ) || 1.0;

        // Dynamic scale to fit canvas
        const canvasScale = Math.min(w, h) / maxDims * 0.7 * (window.devicePixelRatio || 1.0);

        // Project and rotate vertices
        const projected = vertices.map(v => {
            // Center
            let x = v[0] - cx;
            let y = v[1] - cy;
            let z = v[2] - cz;

            // Rotate Y
            let x1 = x * Math.cos(rotY) - z * Math.sin(rotY);
            let z1 = x * Math.sin(rotY) + z * Math.cos(rotY);

            // Rotate X
            let y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
            let z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);

            // Orthographic Projection
            return {
                x: w / 2 + x1 * canvasScale,
                y: h / 2 - y2 * canvasScale, // Invert Y
                z: z2
            };
        });

        // Draw Wireframe Faces
        previewCtx.strokeStyle = "rgba(0, 242, 254, 0.4)";
        previewCtx.lineWidth = 1;

        faces.forEach(f => {
            const p1 = projected[f[0] - 1];
            const p2 = projected[f[1] - 1];
            const p3 = projected[f[2] - 1];

            if (p1 && p2 && p3) {
                previewCtx.beginPath();
                previewCtx.moveTo(p1.x, p1.y);
                previewCtx.lineTo(p2.x, p2.y);
                previewCtx.lineTo(p3.x, p3.y);
                previewCtx.closePath();
                previewCtx.stroke();
            }
        });

        // Draw vertex points
        previewCtx.fillStyle = "#ff007f";
        projected.forEach(p => {
            previewCtx.fillRect(p.x - 1, p.y - 1, 2, 2);
        });
    }

    // ==========================================
    // EXPORTERS & ZIP PACKAGER (using local JSZip)
    // ==========================================
    function exportSelected() {
        if (!selectedMesh) return;
        
        try {
            const zip = new JSZip();
            let objContent = "mtllib model.mtl\nusemtl material_0\n";
            let mtlContent = "";

            // Write vertices
            selectedMesh.vertices.forEach(v => {
                objContent += `v ${v[0]} ${v[1]} ${v[2]}\n`;
            });

            // Write UVs
            selectedMesh.uvs.forEach(uv => {
                objContent += `vt ${uv[0]} ${uv[1]}\n`;
            });

            // Write Normals
            selectedMesh.normals.forEach(n => {
                objContent += `vn ${n[0]} ${n[1]} ${n[2]}\n`;
            });

            // Write Faces
            selectedMesh.faces.forEach(f => {
                if (selectedMesh.uvs.length > 0 && selectedMesh.normals.length > 0) {
                    objContent += `f ${f[0]}/${f[0]}/${f[0]} ${f[1]}/${f[1]}/${f[1]} ${f[2]}/${f[2]}/${f[2]}\n`;
                } else if (selectedMesh.uvs.length > 0) {
                    objContent += `f ${f[0]}/${f[0]} ${f[1]}/${f[1]} ${f[2]}/${f[2]}\n`;
                } else if (selectedMesh.normals.length > 0) {
                    objContent += `f ${f[0]}//${f[0]} ${f[1]}//${f[1]} ${f[2]}//${f[2]}\n`;
                } else {
                    objContent += `f ${f[0]} ${f[1]} ${f[2]}\n`;
                }
            });

            zip.file("model.obj", objContent);

            if (selectedMesh.texturePNG) {
                mtlContent = `newmtl material_0\nKa 1.0 1.0 1.0\nKd 1.0 1.0 1.0\nKs 0.0 0.0 0.0\nd 1.0\nillum 1\nmap_Kd texture.png\n`;
                zip.file("model.mtl", mtlContent);

                const base64Data = selectedMesh.texturePNG.split(',')[1];
                zip.file("texture.png", base64Data, {base64: true});
            }

            zip.generateAsync({type:"blob"}).then(function(content) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(content);
                a.download = `extracted_mesh_${selectedMesh.id}.zip`;
                a.click();
            });
        } catch (e) {
            console.error("[3D Extractor] Selected Export Failed:", e);
            alert("Export failed: " + e.message);
        }
    }

    function exportAll() {
        if (window._3dExtractorCapturedMeshes.length === 0) return;
        
        try {
            const zip = new JSZip();
            let objContent = "mtllib scene.mtl\n";
            let mtlContent = "";
            let vertexOffset = 0;
            let textureCount = 0;

            window._3dExtractorCapturedMeshes.forEach((mesh, index) => {
                objContent += `\n# Mesh ${mesh.id}\n`;
                
                if (mesh.texturePNG) {
                    objContent += `usemtl material_${index}\n`;
                }

                mesh.vertices.forEach(v => {
                    objContent += `v ${v[0]} ${v[1]} ${v[2]}\n`;
                });

                mesh.uvs.forEach(uv => {
                    objContent += `vt ${uv[0]} ${uv[1]}\n`;
                });

                mesh.normals.forEach(n => {
                    objContent += `vn ${n[0]} ${n[1]} ${n[2]}\n`;
                });

                mesh.faces.forEach(f => {
                    const v1 = f[0] + vertexOffset;
                    const v2 = f[1] + vertexOffset;
                    const v3 = f[2] + vertexOffset;
                    
                    if (mesh.uvs.length > 0 && mesh.normals.length > 0) {
                        objContent += `f ${v1}/${v1}/${v1} ${v2}/${v2}/${v2} ${v3}/${v3}/${v3}\n`;
                    } else if (mesh.uvs.length > 0) {
                        objContent += `f ${v1}/${v1} ${v2}/${v2} ${v3}/${v3}\n`;
                    } else if (mesh.normals.length > 0) {
                        objContent += `f ${v1}//${v1} ${v2}//${v2} ${v3}//${v3}\n`;
                    } else {
                        objContent += `f ${v1} ${v2} ${v3}\n`;
                    }
                });

                vertexOffset += mesh.vertices.length;

                if (mesh.texturePNG) {
                    const texName = `texture_${index}.png`;
                    mtlContent += `newmtl material_${index}\nKa 1.0 1.0 1.0\nKd 1.0 1.0 1.0\nKs 0.0 0.0 0.0\nd 1.0\nillum 1\nmap_Kd ${texName}\n\n`;
                    
                    const base64Data = mesh.texturePNG.split(',')[1];
                    zip.file(texName, base64Data, {base64: true});
                    textureCount++;
                }
            });

            zip.file("scene.obj", objContent);
            if (textureCount > 0) {
                zip.file("scene.mtl", mtlContent);
            }

            zip.generateAsync({type:"blob"}).then(function(content) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(content);
                a.download = `extracted_scene_all.zip`;
                a.click();
            });
        } catch (e) {
            console.error("[3D Extractor] Scene Export Failed:", e);
            alert("Export failed: " + e.message);
        }
    }

    // Message listener from content script
    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        
        if (event.data.type === "3D_EXTRACTOR_TOGGLE_UI") {
            toggleDashboard();
        } else if (event.data.type === "3D_EXTRACTOR_START_CAPTURE") {
            if (!window._3dExtractorCapturing) toggleCapture();
        } else if (event.data.type === "3D_EXTRACTOR_STOP_CAPTURE") {
            if (window._3dExtractorCapturing) toggleCapture();
        }
    });

    // Injected when the document finishes body loading
    if (document.body) {
        injectUI();
    } else {
        window.addEventListener('DOMContentLoaded', injectUI);
    }

})();
