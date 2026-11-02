// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { CORE_URL, FFMessageType } from "./const.js";
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED, ERROR_IMPORT_FAILURE, } from "./errors.js";
let ffmpeg;
const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL, }) => {
    const first = !ffmpeg;
    try {
        if (!_coreURL)
            _coreURL = CORE_URL;
        // when web worker type is `classic`.
        importScripts(_coreURL);
    }
    catch {
        if (!_coreURL || _coreURL === CORE_URL)
            _coreURL = CORE_URL.replace('/umd/', '/esm/');
        // when web worker type is `module`.
        self.createFFmpegCore = (await import(
        /* @vite-ignore */ _coreURL)).default;
        if (!self.createFFmpegCore) {
            throw ERROR_IMPORT_FAILURE;
        }
    }
    const coreURL = _coreURL;
    const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, ".wasm");
    const workerURL = _workerURL
        ? _workerURL
        : _coreURL.replace(/.js$/g, ".worker.js");
    ffmpeg = await self.createFFmpegCore({
        // Fix `Overload resolution failed.` when using multi-threaded ffmpeg-core.
        // Encoded wasmURL and workerURL in the URL as a hack to fix locateFile issue.
        mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
    });
    ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
    ffmpeg.setProgress((data) => self.postMessage({
        type: FFMessageType.PROGRESS,
        data,
    }));
    return first;
};
const exec = ({ args, timeout = -1 }) => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.exec(...args);
    const ret = ffmpeg.ret;
    ffmpeg.reset();
    return ret;
};
const ffprobe = ({ args, timeout = -1 }) => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.ffprobe(...args);
    const ret = ffmpeg.ret;
    ffmpeg.reset();
    return ret;
};
const writeFile = ({ path, data }) => {
    ffmpeg.FS.writeFile(path, data);
    return true;
};
const readFile = ({ path, encoding }) => {
    if (encoding === "blob") {
        try {
            const lookup = ffmpeg.FS.lookupPath(path);
            if (lookup && lookup.node && lookup.node.contents) {
                const contents = lookup.node.contents;
                const size = lookup.node.usedBytes !== undefined ? lookup.node.usedBytes : contents.length;
                const mime = path.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
                const CHUNK_SIZE = 32 * 1024 * 1024;
                const chunks = [];
                for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
                    chunks.push(contents.subarray(offset, Math.min(size, offset + CHUNK_SIZE)));
                }
                const blob = new Blob(chunks, { type: mime });
                try { ffmpeg.FS.unlink(path); } catch {}
                return blob;
            }
        } catch (e) {
            console.error("Worker read blob error:", e);
        }
        const data = ffmpeg.FS.readFile(path, { encoding: "binary" });
        const mime = path.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
        const blob = new Blob([data], { type: mime });
        try { ffmpeg.FS.unlink(path); } catch {}
        return blob;
    }
    return ffmpeg.FS.readFile(path, { encoding });
};
const deleteFile = ({ path }) => {
    ffmpeg.FS.unlink(path);
    return true;
};
const deleteFiles = ({ paths }) => {
    if (Array.isArray(paths)) {
        for (let i = 0; i < paths.length; i++) {
            try { ffmpeg.FS.unlink(paths[i]); } catch {}
        }
    }
    return true;
};
const rename = ({ oldPath, newPath }) => {
    ffmpeg.FS.rename(oldPath, newPath);
    return true;
};
// TODO: check if creation works.
const createDir = ({ path }) => {
    ffmpeg.FS.mkdir(path);
    return true;
};
const listDir = ({ path }) => {
    const names = ffmpeg.FS.readdir(path);
    const nodes = [];
    for (const name of names) {
        const stat = ffmpeg.FS.stat(`${path}/${name}`);
        const isDir = ffmpeg.FS.isDir(stat.mode);
        nodes.push({ name, isDir });
    }
    return nodes;
};
// TODO: check if deletion works.
const deleteDir = ({ path }) => {
    ffmpeg.FS.rmdir(path);
    return true;
};
const mount = ({ fsType, options, mountPoint }) => {
    const str = fsType;
    const fs = ffmpeg.FS.filesystems[str];
    if (!fs)
        return false;
    ffmpeg.FS.mount(fs, options, mountPoint);
    return true;
};
const unmount = ({ mountPoint }) => {
    ffmpeg.FS.unmount(mountPoint);
    return true;
};
self.onmessage = async ({ data: { id, type, data: _data }, }) => {
    const trans = [];
    let data;
    try {
        if (type !== FFMessageType.LOAD && !ffmpeg)
            throw ERROR_NOT_LOADED; // eslint-disable-line
        switch (type) {
            case FFMessageType.LOAD:
                data = await load(_data);
                break;
            case FFMessageType.EXEC:
                data = exec(_data);
                break;
            case FFMessageType.FFPROBE:
                data = ffprobe(_data);
                break;
            case FFMessageType.WRITE_FILE:
                data = writeFile(_data);
                break;
            case FFMessageType.READ_FILE:
                data = readFile(_data);
                break;
            case FFMessageType.DELETE_FILE:
                data = deleteFile(_data);
                break;
            case FFMessageType.DELETE_FILES:
                data = deleteFiles(_data);
                break;
            case FFMessageType.RENAME:
                data = rename(_data);
                break;
            case FFMessageType.CREATE_DIR:
                data = createDir(_data);
                break;
            case FFMessageType.LIST_DIR:
                data = listDir(_data);
                break;
            case FFMessageType.DELETE_DIR:
                data = deleteDir(_data);
                break;
            case FFMessageType.MOUNT:
                data = mount(_data);
                break;
            case FFMessageType.UNMOUNT:
                data = unmount(_data);
                break;
            default:
                throw ERROR_UNKNOWN_MESSAGE_TYPE;
        }
    }
    catch (e) {
        self.postMessage({
            id,
            type: FFMessageType.ERROR,
            data: e.toString(),
        });
        return;
    }
    if (data instanceof Uint8Array) {
        trans.push(data.buffer);
    }
    self.postMessage({ id, type, data }, trans);
};
