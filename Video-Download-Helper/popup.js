// Created by DINKIssTyle on 2026. Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
document.addEventListener("DOMContentLoaded", async () => {
  const noMediaView = document.getElementById("no-media-view");
  const mediaListView = document.getElementById("media-list-view");
  const progressView = document.getElementById("download-progress-view");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const statusText = document.getElementById("status-text");

  // Progress Elements
  const targetTitle = document.getElementById("target-title");
  const targetUrlLabel = document.getElementById("target-url-label");
  const percentVal = document.getElementById("percent-val");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const speedVal = document.getElementById("speed-val");
  const segmentsVal = document.getElementById("segments-val");
  const etaVal = document.getElementById("eta-val");
  const logTerminal = document.getElementById("log-terminal");

  const pauseBtn = document.getElementById("pause-btn");
  const resumeBtn = document.getElementById("resume-btn");
  const cancelBtn = document.getElementById("cancel-btn");

  // Formatter helpers for resolution/duration/size
  function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + " KB";
    const mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(1) + " MB";
    const gb = mb / 1024;
    return gb.toFixed(1) + " GB";
  }

  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "";
    const sec = Math.floor(seconds % 60);
    const min = Math.floor((seconds / 60) % 60);
    const hour = Math.floor(seconds / 3600);
    
    const pad = (num) => String(num).padStart(2, "0");
    
    if (hour > 0) {
      return `${hour}:${pad(min)}:${pad(sec)}`;
    }
    return `${pad(min)}:${pad(sec)}`;
  }

  // Get active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab ? activeTab.id : null;

  // 1. Initial State Check (Sync with Background)
  chrome.runtime.sendMessage({ action: "getDownloadStatus" }, (response) => {
    if (response && response.activeDownload) {
      const state = response.activeDownload;
      showProgressView(state);
      // Re-populate historical logs
      if (state.logs) {
        logTerminal.innerHTML = "";
        state.logs.forEach(msg => appendLogLine(msg));
      }
      
      // Trigger decision if opened in waiting state
      if (state.status === "waiting_decision" && !confirmOpened) {
        confirmOpened = true;
        setTimeout(() => {
          const skip = confirm(`일부 세그먼트(${state.failedCount}개) 다운로드에 실패했습니다.\n실패한 조각을 제외하고 강제로 다운로드를 완료할까요?`);
          if (skip) {
            chrome.runtime.sendMessage({ action: "confirmSkipCompile" }, () => {
              confirmOpened = false;
            });
          } else {
            chrome.runtime.sendMessage({ action: "cancelHlsDownload" }, () => {
              confirmOpened = false;
            });
          }
        }, 300);
      }
    } else {
      if (tabId) loadMedia();
    }
  });

  // 2. Load detected media items
  function loadMedia() {
    chrome.runtime.sendMessage({ action: "getMediaList", tabId: tabId }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      const mediaList = response ? response.mediaList || [] : [];
      renderMediaList(mediaList);
    });
  }

  let showAll = false;
  let confirmOpened = false;

  // Reload media list periodically if popup is open to catch async metadata updates (like resolution/duration/size)
  let reloadInterval = setInterval(() => {
    if (tabId && !progressView.classList.contains("hidden")) {
      // If we are showing progress view, do not reload
      return;
    }
    if (tabId) {
      chrome.runtime.sendMessage({ action: "getMediaList", tabId: tabId }, (response) => {
        if (!chrome.runtime.lastError && response && response.mediaList) {
          const mediaList = response.mediaList;
          const groupA = mediaList.filter(item => item.duration && item.resolution && item.size);
          const groupB = mediaList.filter(item => (item.duration || item.resolution || item.size) && !(item.duration && item.resolution && item.size));
          const groupC = mediaList.filter(item => !(item.duration || item.resolution || item.size));
          
          let expectedList = [];
          if (groupA.length > 0) {
            expectedList = showAll ? [...groupA, ...groupB, ...groupC] : groupA;
          } else if (groupB.length > 0) {
            expectedList = showAll ? [...groupB, ...groupC] : groupB;
          } else {
            expectedList = groupC;
          }

          // Only update if metadata changed to prevent flickering
          const currentCards = mediaListView.querySelectorAll(".media-card");
          if (currentCards.length === expectedList.length) {
            expectedList.forEach((item, index) => {
              const card = currentCards[index];
              if (card) {
                const metaContainer = card.querySelector(".media-meta");
                if (metaContainer) {
                  let metaBadges = `
                    <span class="meta-badge ${item.type}-badge">${item.type}</span>
                  `;
                  if (item.extension && item.extension.toLowerCase() !== item.type.toLowerCase()) {
                    metaBadges += `<span class="meta-badge">${item.extension}</span>`;
                  }
                  if (item.resolution) metaBadges += `<span class="meta-badge res-badge">${item.resolution}</span>`;
                  if (item.duration) metaBadges += `<span class="meta-badge duration-badge">${formatDuration(item.duration)}</span>`;
                  if (item.size) metaBadges += `<span class="meta-badge size-badge">${formatSize(item.size)}</span>`;
                  
                  if (metaContainer.innerHTML !== metaBadges) {
                    metaContainer.innerHTML = metaBadges;
                  }
                }
              }
            });
          } else {
            renderMediaList(response.mediaList);
          }
        }
      });
    }
  }, 1000);

  // Clear reload interval when popup closes
  window.addEventListener("unload", () => {
    clearInterval(reloadInterval);
  });

  function renderMediaList(mediaList) {
    // Show Empty or List
    progressView.classList.add("hidden");

    if (mediaList.length === 0) {
      noMediaView.classList.remove("hidden");
      mediaListView.classList.add("hidden");
      clearAllBtn.style.opacity = "0.5";
      clearAllBtn.disabled = true;
      return;
    }

    noMediaView.classList.add("hidden");
    mediaListView.classList.remove("hidden");
    clearAllBtn.style.opacity = "1";
    clearAllBtn.disabled = false;

    mediaListView.innerHTML = "";

    // Split list into high priority, medium priority, and low priority
    const groupA = mediaList.filter(item => item.duration && item.resolution && item.size);
    const groupB = mediaList.filter(item => (item.duration || item.resolution || item.size) && !(item.duration && item.resolution && item.size));
    const groupC = mediaList.filter(item => !(item.duration || item.resolution || item.size));

    let listToShow = [];
    let showMoreButton = false;
    let hiddenCount = 0;

    if (groupA.length > 0) {
      if (showAll) {
        listToShow = [...groupA, ...groupB, ...groupC];
        showMoreButton = (groupB.length + groupC.length) > 0;
      } else {
        listToShow = groupA;
        showMoreButton = (groupB.length + groupC.length) > 0;
        hiddenCount = groupB.length + groupC.length;
      }
    } else if (groupB.length > 0) {
      if (showAll) {
        listToShow = [...groupB, ...groupC];
        showMoreButton = groupC.length > 0;
      } else {
        listToShow = groupB;
        showMoreButton = groupC.length > 0;
        hiddenCount = groupC.length;
      }
    } else {
      listToShow = groupC;
      showMoreButton = false;
    }

    listToShow.forEach((item) => {
      const card = document.createElement("div");
      card.className = "media-card";

      // Select icon markup
      let iconClass = item.type;
      let iconSvg = "";
      if (item.type === "m3u8") {
        iconSvg = `<svg class="media-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      } else if (item.type === "audio") {
        iconSvg = `<svg class="media-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
      } else {
        iconSvg = `<svg class="media-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
      }

      // Thumbnail check
      let thumbnailMarkup = "";
      if (item.thumbnail) {
        thumbnailMarkup = `
          <img class="media-thumbnail-img" src="${item.thumbnail}" alt="Thumbnail">
          <div class="media-icon-container ${iconClass} hidden" style="position: absolute; top:0; left:0;">
            ${iconSvg}
          </div>
        `;
      } else {
        thumbnailMarkup = `
          <div class="media-icon-container ${iconClass}">
            ${iconSvg}
          </div>
        `;
      }

      let metaBadges = `
        <span class="meta-badge ${item.type}-badge">${item.type}</span>
      `;
      if (item.extension && item.extension.toLowerCase() !== item.type.toLowerCase()) {
        metaBadges += `<span class="meta-badge">${item.extension}</span>`;
      }
      if (item.resolution) {
        metaBadges += `<span class="meta-badge res-badge">${item.resolution}</span>`;
      }
      if (item.duration) {
        metaBadges += `<span class="meta-badge duration-badge">${formatDuration(item.duration)}</span>`;
      }
      if (item.size) {
        metaBadges += `<span class="meta-badge size-badge">${formatSize(item.size)}</span>`;
      }

      card.innerHTML = `
        <div class="media-preview-area">
          ${thumbnailMarkup}
        </div>
        <div class="media-info">
          <div class="media-name" title="${item.filename}">${item.filename}</div>
          <div class="media-meta">
            ${metaBadges}
          </div>
        </div>
        <div class="media-actions">
          <button class="icon-btn open-link-btn" title="Open in New Tab">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
          <button class="icon-btn copy-url-btn" title="Copy URL">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="download-btn run-download-btn">Download</button>
        </div>
      `;

      // Safe image fallback
      const img = card.querySelector(".media-thumbnail-img");
      const iconFallback = card.querySelector(".media-icon-container");
      if (img && iconFallback) {
        img.onerror = () => {
          img.classList.add("hidden");
          iconFallback.classList.remove("hidden");
        };
      }

      // Open Link Action
      card.querySelector(".open-link-btn").addEventListener("click", () => {
        chrome.tabs.create({ url: item.url });
      });

      // Copy Action
      card.querySelector(".copy-url-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(item.url).then(() => {
          showStatus("URL copied!");
        });
      });

      // Download Action
      card.querySelector(".run-download-btn").addEventListener("click", () => {
        if (item.type === "m3u8") {
          // Trigger In-Popup HLS Download pipeline
          chrome.runtime.sendMessage({
            action: "startHlsDownload",
            data: {
              url: item.url,
              filename: item.filename,
              referer: item.originUrl,
              origin: item.originUrl
            }
          }, (res) => {
            if (res && res.success) {
              logTerminal.innerHTML = `<div class="log-line system">[System] Initializing download stream...</div>`;
              showProgressView({
                filename: item.filename,
                url: item.url,
                status: "initializing",
                percent: 0,
                downloadedCount: 0,
                totalCount: 0,
                speed: "0 KB/s",
                eta: "--:--",
                logs: []
              });
            }
          });
        } else {
          // Trigger standard browser download
          chrome.downloads.download({
            url: item.url,
            filename: item.filename,
            saveAs: true
          });
          showStatus("Download started...");
        }
      });

      mediaListView.appendChild(card);
    });

    if (showMoreButton) {
      const moreBtn = document.createElement("button");
      moreBtn.className = "more-btn";
      if (showAll) {
        moreBtn.innerHTML = `
          접기
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(180deg); margin-left: 4px;">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        `;
        moreBtn.addEventListener("click", () => {
          showAll = false;
          renderMediaList(mediaList);
        });
      } else {
        moreBtn.innerHTML = `
          더 보기 (기타 ${hiddenCount}개 항목)
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 4px;">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        `;
        moreBtn.addEventListener("click", () => {
          showAll = true;
          renderMediaList(mediaList);
        });
      }
      mediaListView.appendChild(moreBtn);
    }
  }

  // Switch display to progress dashboard
  function showProgressView(state) {
    noMediaView.classList.add("hidden");
    mediaListView.classList.add("hidden");
    clearAllBtn.style.opacity = "0.5";
    clearAllBtn.disabled = true;
    progressView.classList.remove("hidden");

    targetTitle.textContent = state.filename;
    targetUrlLabel.textContent = state.url;
    updateProgressUI(state);
  }

  // Draw metrics
  function updateProgressUI(state) {
    percentVal.textContent = `${state.percent}%`;
    progressBarFill.style.width = `${state.percent}%`;
    speedVal.textContent = state.speed;
    segmentsVal.textContent = `${state.downloadedCount} / ${state.totalCount}`;
    etaVal.textContent = state.eta;

    // Button states
    if (state.status === "paused") {
      pauseBtn.classList.add("hidden");
      resumeBtn.classList.remove("hidden");
    } else {
      pauseBtn.classList.remove("hidden");
      resumeBtn.classList.add("hidden");
    }
  }

  // Append new logs
  function appendLogLine(msg) {
    const line = document.createElement("div");
    line.className = "log-line info";
    if (msg.includes("[success]")) line.className = "log-line success";
    else if (msg.includes("[error]")) line.className = "log-line error";
    else if (msg.includes("[warning]")) line.className = "log-line warning";
    else if (msg.includes("[system]")) line.className = "log-line system";
    
    line.textContent = msg;
    logTerminal.appendChild(line);
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }

  function showStatus(text) {
    statusText.textContent = text;
    setTimeout(() => {
      statusText.textContent = "Ready to download";
    }, 2500);
  }

  // 3. Control Button Listeners
  pauseBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "pauseHlsDownload" }, () => {
      pauseBtn.classList.add("hidden");
      resumeBtn.classList.remove("hidden");
    });
  });

  resumeBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "resumeHlsDownload" }, () => {
      pauseBtn.classList.remove("hidden");
      resumeBtn.classList.add("hidden");
    });
  });

  cancelBtn.addEventListener("click", () => {
    if (confirm("Cancel this download?")) {
      chrome.runtime.sendMessage({ action: "cancelHlsDownload" }, () => {
        progressView.classList.add("hidden");
        if (tabId) loadMedia();
      });
    }
  });

  // 4. Listen to progress events from background (Offscreen doc)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "popupProgressBroadcast") {
      const state = message.data;
      updateProgressUI(state);

      // Append delta logs if they exist
      if (state.logs && state.logs.length > 0) {
        state.logs.forEach(msg => appendLogLine(msg));
      }

      // Check if waiting for user decision on failed segments
      if (state.status === "waiting_decision" && !confirmOpened) {
        confirmOpened = true;
        setTimeout(() => {
          const skip = confirm(`일부 세그먼트(${state.failedCount}개) 다운로드에 실패했습니다.\n실패한 조각을 제외하고 강제로 다운로드를 완료할까요?`);
          if (skip) {
            chrome.runtime.sendMessage({ action: "confirmSkipCompile" }, () => {
              confirmOpened = false;
            });
          } else {
            chrome.runtime.sendMessage({ action: "cancelHlsDownload" }, () => {
              confirmOpened = false;
            });
          }
        }, 100);
      }

      // Check if finished or failed
      if (state.status === "completed" || state.status === "cancelled" || state.status === "failed") {
        setTimeout(() => {
          progressView.classList.add("hidden");
          if (tabId) loadMedia();
        }, 1500);
      }
    }
  });

  // Clear list action
  clearAllBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "clearMediaList", tabId: tabId }, (response) => {
      if (response && response.success) {
        showStatus("List cleared");
        loadMedia();
      }
    });
  });
});
