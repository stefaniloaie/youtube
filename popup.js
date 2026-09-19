/**
 * Popup script for YouTube History Summarizer
 * Loads videos from Today's watch history, renders a checklist with checkboxes,
 * and sends selected videos to FastAPI + Gemini for summarization.
 */

let backendUrl = "https://youtube-production-9f45.up.railway.app";
let geminiApiKey = "";
let currentVideos = [];
let selectedVideoIds = new Set();
let currentDigest = "";

document.addEventListener("DOMContentLoaded", async () => {
  const selectSection = document.getElementById("select-section");
  const btnRefresh = document.getElementById("btn-refresh");
  const btnSelectAll = document.getElementById("btn-select-all");
  const btnDeselectAll = document.getElementById("btn-deselect-all");
  const checklistStats = document.getElementById("checklist-stats");
  const videoListEl = document.getElementById("video-list");
  const btnSummarize = document.getElementById("btn-summarize");
  const statusBar = document.getElementById("status-bar");
  const statusText = document.getElementById("status-text");
  const statusSpinner = document.getElementById("status-spinner");
  const outputSection = document.getElementById("output-section");
  const outputBox = document.getElementById("output-box");
  const btnCopy = document.getElementById("btn-copy");
  const viewReportBtn = document.getElementById("viewReportBtn");
  const copyLabel = document.getElementById("copy-label");
  const backendDot = document.getElementById("backend-dot");
  const backendText = document.getElementById("backend-text");
  const settingsPanel = document.getElementById("settings-panel");
  const btnToggleSettings = document.getElementById("btn-toggle-settings");
  const inputApiKey = document.getElementById("input-api-key");
  const btnToggleKey = document.getElementById("btn-toggle-key");
  const inputBackendUrl = document.getElementById("input-backend-url");
  const btnTestBackend = document.getElementById("btn-test-backend");
  const btnSaveSettings = document.getElementById("btn-save-settings");
  const btnClearKey = document.getElementById("btn-clear-key");
  const settingsFeedback = document.getElementById("settings-feedback");

  // Helper to read from chrome.storage.sync (with fallback to local)
  function getSyncStorage(keys, callback) {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(keys, (res) => {
        if (res && (res.gemini_api_key || res.geminiApiKey || res.backendUrl)) {
          callback(res);
        } else if (chrome.storage.local) {
          chrome.storage.local.get(keys, callback);
        } else {
          callback(res || {});
        }
      });
    } else if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, callback);
    } else {
      callback({});
    }
  }

  function setSyncStorage(items, callback) {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(items, () => {
        if (chrome.storage.local) chrome.storage.local.set(items);
        if (callback) callback();
      });
    } else if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(items, callback);
    } else if (callback) {
      callback();
    }
  }

  // Load backend URL and Gemini API key from chrome.storage.sync
  getSyncStorage(["backendUrl", "gemini_api_key", "geminiApiKey"], (res) => {
    if (res) {
      if (res.backendUrl) {
        backendUrl = res.backendUrl;
        inputBackendUrl.value = backendUrl;
      }
      const savedKey = res.gemini_api_key || res.geminiApiKey;
      if (savedKey) {
        geminiApiKey = savedKey;
        inputApiKey.value = geminiApiKey;
      }
    }
    checkBackendHealth();
  });

  // Load Today's watch history automatically on popup launch
  loadWatchHistory("today");

  // Filter change handler
  selectSection.addEventListener("change", () => {
    loadWatchHistory(selectSection.value);
  });

  // Refresh button handler
  btnRefresh.addEventListener("click", () => {
    loadWatchHistory(selectSection.value);
  });

  // Select All
  btnSelectAll.addEventListener("click", () => {
    currentVideos.forEach((v) => selectedVideoIds.add(v.videoId));
    renderVideoChecklist();
    updateSummarizeButton();
  });

  // Deselect All
  btnDeselectAll.addEventListener("click", () => {
    selectedVideoIds.clear();
    renderVideoChecklist();
    updateSummarizeButton();
  });

  // Toggle settings panel
  btnToggleSettings.addEventListener("click", () => {
    const isHidden = settingsPanel.style.display === "none" || !settingsPanel.style.display;
    settingsPanel.style.display = isHidden ? "block" : "none";
  });

  // Toggle show/hide API key
  btnToggleKey.addEventListener("click", () => {
    if (inputApiKey.type === "password") {
      inputApiKey.type = "text";
      btnToggleKey.textContent = "Hide";
    } else {
      inputApiKey.type = "password";
      btnToggleKey.textContent = "Show";
    }
  });

  // Test backend connection
  btnTestBackend.addEventListener("click", async () => {
    const candidate = inputBackendUrl.value.trim().replace(/\/$/, "");
    setSettingsFeedback("Testing connection to " + candidate + "...", "var(--text-muted)");
    const isHealthy = await testUrl(candidate);
    if (isHealthy) {
      setSettingsFeedback("✓ Connected successfully to " + candidate, "var(--success)");
      backendDot.classList.remove("error");
    } else {
      setSettingsFeedback("✗ Failed to reach " + candidate + ". Is uvicorn running?", "var(--danger)");
      backendDot.classList.add("error");
    }
  });

  // Clear API key
  btnClearKey.addEventListener("click", () => {
    inputApiKey.value = "";
    geminiApiKey = "";
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.remove(["gemini_api_key", "geminiApiKey"]);
    }
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(["gemini_api_key", "geminiApiKey"]);
    }
    setSettingsFeedback("API key cleared from chrome.storage.sync. Using server default.", "var(--text-muted)");
  });

  // Save all settings (Backend URL + API Key)
  btnSaveSettings.addEventListener("click", async () => {
    const candidateUrl = inputBackendUrl.value.trim().replace(/\/$/, "");
    const candidateKey = inputApiKey.value.trim();

    backendUrl = candidateUrl;
    geminiApiKey = candidateKey;

    setSyncStorage({
      backendUrl: candidateUrl,
      gemini_api_key: candidateKey,
      geminiApiKey: candidateKey
    });

    setSettingsFeedback("Saving and testing...", "var(--text-muted)");

    const isHealthy = await testUrl(candidateUrl);
    if (isHealthy) {
      const keyInfo = candidateKey ? "with personal key in chrome.storage.sync" : "using backend default key";
      setSettingsFeedback(`✓ Settings saved (${keyInfo})`, "var(--success)");
      backendDot.classList.remove("error");
      backendText.textContent = `Backend: ${candidateUrl.replace(/^https?:\/\//, "")}`;
    } else {
      setSettingsFeedback(`Saved to sync storage, but cannot reach ${candidateUrl}. Ensure uvicorn is running.`, "var(--warning)");
      backendDot.classList.add("error");
    }
  });

  // Open dedicated options page if clicked
  const btnOpenOptions = document.getElementById("btn-open-options");
  if (btnOpenOptions) {
    btnOpenOptions.addEventListener("click", (e) => {
      e.preventDefault();
      if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL("options.html"));
      }
    });
  }

  function setSettingsFeedback(text, color) {
    settingsFeedback.textContent = text;
    settingsFeedback.style.color = color || "var(--text-muted)";
  }

  async function testUrl(url) {
    try {
      const res = await fetch(`${url}/health`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function checkBackendHealth() {
    backendText.textContent = `Backend: ${backendUrl.replace(/^https?:\/\//, "")}`;
    const ok = await testUrl(backendUrl);
    if (ok) {
      backendDot.classList.remove("error");
    } else {
      // Try fallback to 127.0.0.1
      if (backendUrl.includes("localhost")) {
        const alt = backendUrl.replace("localhost", "127.0.0.1");
        const altOk = await testUrl(alt);
        if (altOk) {
          backendUrl = alt;
          inputBackendUrl.value = backendUrl;
          backendDot.classList.remove("error");
          backendText.textContent = `Backend: ${alt.replace(/^https?:\/\//, "")}`;
          return;
        }
      }
      backendDot.classList.add("error");
    }
  }

  document.getElementById("status-indicator-click")?.addEventListener("click", checkBackendHealth);

  function setStatus(msg, isVisible = true, isError = false) {
    if (!isVisible) {
      statusBar.style.display = "none";
      statusBar.classList.remove("error-state");
      return;
    }
    statusBar.style.display = "flex";
    if (isError) {
      statusBar.classList.add("error-state");
      statusSpinner.style.display = "none";
    } else {
      statusBar.classList.remove("error-state");
      statusSpinner.style.display = "block";
    }
    statusText.innerHTML = msg;
  }

  /**
   * Loads watch history from background script
   */
  async function loadWatchHistory(sectionFilter = "today") {
    setStatus("", false);
    checklistStats.textContent = "Fetching videos...";
    videoListEl.innerHTML = `
      <div class="empty-state">
        <div class="spinner" style="margin: 0 auto 8px auto;"></div>
        <div>Loading ${sectionFilter === "today" ? "Today's" : sectionFilter} videos from YouTube...</div>
      </div>
    `;
    btnSummarize.disabled = true;

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "FETCH_WATCH_HISTORY", sectionFilter },
          (resp) => resolve(resp)
        );
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Could not retrieve YouTube history. Make sure you are signed in at https://www.youtube.com.");
      }

      // Filter out any YouTube Shorts
      const rawVideos = response.videos || [];
      currentVideos = rawVideos.filter(v => {
        if (!v) return false;
        if (v.url && v.url.includes('/shorts/')) return false;
        if (v.title && (/#shorts\b|#short\b/i.test(v.title))) return false;
        return true;
      });

      // Check if sections metadata exists and update select dropdown options
      if (Array.isArray(response.sections) && response.sections.length > 0) {
        updateSectionsDropdown(response.sections, response.activeSection);
      }

      // Default: select all loaded videos for convenience
      selectedVideoIds = new Set(currentVideos.map((v) => v.videoId));

      renderVideoChecklist();
      updateSummarizeButton();
    } catch (err) {
      console.error("Failed to load history:", err);
      const errMsg = err?.message || String(err);
      checklistStats.textContent = "0 videos loaded";
      videoListEl.innerHTML = `
        <div class="empty-state" style="color: #fca5a5;">
          <strong>Error reading history</strong>
          <div style="font-size: 11px; margin-top: 4px; color: #cbd5e1;">${errMsg}</div>
        </div>
      `;
      setStatus(errMsg, true, true);
    }
  }

  function updateSectionsDropdown(sections, activeSection) {
    const existingValues = new Set(["today", "yesterday", "all"]);
    sections.forEach((sec) => {
      const val = sec.title.toLowerCase();
      if (!existingValues.has(val)) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = `${sec.title} (${sec.count})`;
        selectSection.appendChild(opt);
        existingValues.add(val);
      }
    });
  }

  /**
   * Renders the checklist with checkboxes for every video
   */
  function renderVideoChecklist() {
    if (!currentVideos || currentVideos.length === 0) {
      checklistStats.textContent = "0 videos found";
      videoListEl.innerHTML = `
        <div class="empty-state">
          No videos found for this period in your watch history.
        </div>
      `;
      return;
    }

    const selectedCount = selectedVideoIds.size;
    checklistStats.textContent = `${selectedCount} of ${currentVideos.length} selected`;

    videoListEl.innerHTML = "";

    currentVideos.forEach((video) => {
      const isChecked = selectedVideoIds.has(video.videoId);

      const row = document.createElement("div");
      row.className = `video-row ${isChecked ? "selected" : ""}`;
      row.dataset.videoId = video.videoId;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "video-checkbox";
      checkbox.checked = isChecked;
      checkbox.title = "Select video for summary";

      // Prevent duplicate row click event
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        toggleVideoSelection(video.videoId, checkbox.checked);
      });

      // Thumbnail
      const thumb = document.createElement("img");
      thumb.className = "video-thumb";
      thumb.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
      thumb.alt = "";
      thumb.onerror = () => {
        thumb.src = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
      };

      // Info
      const info = document.createElement("div");
      info.className = "video-info";

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = video.title || "Untitled Video";
      title.title = video.title;

      const meta = document.createElement("div");
      meta.className = "video-meta";

      if (video.channel) {
        const channelSpan = document.createElement("span");
        channelSpan.className = "meta-channel";
        channelSpan.textContent = video.channel;
        meta.appendChild(channelSpan);
      }

      if (video.duration) {
        const durSpan = document.createElement("span");
        durSpan.className = "duration-badge";
        durSpan.textContent = video.duration;
        meta.appendChild(durSpan);
      }

      info.appendChild(title);
      info.appendChild(meta);

      // Entire row is clickable to toggle
      row.addEventListener("click", () => {
        const nextState = !selectedVideoIds.has(video.videoId);
        checkbox.checked = nextState;
        toggleVideoSelection(video.videoId, nextState);
      });

      row.appendChild(checkbox);
      row.appendChild(thumb);
      row.appendChild(info);

      videoListEl.appendChild(row);
    });
  }

  function toggleVideoSelection(videoId, isSelected) {
    if (isSelected) {
      selectedVideoIds.add(videoId);
    } else {
      selectedVideoIds.delete(videoId);
    }
    const selectedCount = selectedVideoIds.size;
    checklistStats.textContent = `${selectedCount} of ${currentVideos.length} selected`;

    // Highlight row
    const row = videoListEl.querySelector(`[data-video-id="${videoId}"]`);
    if (row) {
      if (isSelected) {
        row.classList.add("selected");
      } else {
        row.classList.remove("selected");
      }
    }

    updateSummarizeButton();
  }

  function updateSummarizeButton() {
    const count = selectedVideoIds.size;
    btnSummarize.disabled = count === 0;
    btnSummarize.innerHTML = `<span>✨ Summarize ${count} Selected Video${count === 1 ? "" : "s"}</span>`;
  }

  /**
   * Summarize selected videos by calling FastAPI
   */
  btnSummarize.addEventListener("click", async () => {
    const selectedVideos = currentVideos.filter((v) => selectedVideoIds.has(v.videoId));

    if (selectedVideos.length === 0) {
      return;
    }

    btnSummarize.disabled = true;
    outputSection.style.display = "none";
    outputBox.textContent = "";
    currentDigest = "";

    try {
      setStatus(
        `<strong>[1/2] Processing Transcripts & Gemini</strong><br>` +
        `Sending ${selectedVideos.length} selected videos to FastAPI backend (${backendUrl})...`
      );

      let backendResponse;
      let usedUrl = backendUrl;

      const requestHeaders = { "Content-Type": "application/json" };
      if (geminiApiKey) {
        requestHeaders["gemini_api_key"] = geminiApiKey;
        requestHeaders["x-gemini-api-key"] = geminiApiKey;
      }

      const requestBody = JSON.stringify({
        videos: selectedVideos,
        gemini_api_key: geminiApiKey || undefined,
        apiKey: geminiApiKey || undefined,
      });

      try {
        backendResponse = await fetch(`${usedUrl}/api/summarize`, {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
        });
      } catch {
        // Try alternate localhost <-> 127.0.0.1
        const altUrl = usedUrl.includes("localhost")
          ? usedUrl.replace("localhost", "127.0.0.1")
          : usedUrl.replace("127.0.0.1", "localhost");

        try {
          backendResponse = await fetch(`${altUrl}/api/summarize`, {
            method: "POST",
            headers: requestHeaders,
            body: requestBody,
          });
          usedUrl = altUrl;
        } catch {
          throw new Error(
            `<strong>Cannot reach FastAPI backend at ${usedUrl}</strong>.<br><br>` +
            `Make sure your Python server is running:<br>` +
            `<code style="background: rgba(0,0,0,0.4); padding: 3px 6px; border-radius: 4px; display:inline-block; margin-top:4px;">uvicorn main:app --reload --port 8000</code>`
          );
        }
      }

      if (!backendResponse.ok) {
        const errorData = await backendResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || `FastAPI backend error: HTTP ${backendResponse.status}`);
      }

      const data = await backendResponse.json();
      currentDigest = data.digest || data.summary || "No summary returned.";
      
      // Save latestSummary payload to chrome.storage.local for the Full-Screen Report Viewer
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          latestSummary: currentDigest,
          latestSummaryTimestamp: new Date().toLocaleString([], { 
            year: 'numeric', month: 'short', day: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
          }),
          latestSummaryVideosCount: selectedVideos.length,
        });
      }

      setStatus("", false);
      outputSection.style.display = "flex";
      outputBox.textContent = currentDigest;
      backendDot.classList.remove("error");

      // Scroll to output
      outputSection.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.error("Summarization error:", err);
      setStatus(err?.message || String(err), true, true);
    } finally {
      updateSummarizeButton();
    }
  });


  // Open Full-Screen Report in new tab
  if (viewReportBtn) {
    viewReportBtn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
      } else {
        window.open("report.html", "_blank");
      }
    });
  }

  // Copy to clipboard
  btnCopy.addEventListener("click", async () => {
    if (!currentDigest) return;
    try {
      await navigator.clipboard.writeText(currentDigest);
      copyLabel.textContent = "✓ Copied to Clipboard!";
      setTimeout(() => {
        copyLabel.textContent = "📋 Copy Markdown";
      }, 2000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  });
});
