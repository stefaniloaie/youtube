/**
 * Options script for YouTube History Summarizer
 * Manages Bring-Your-Own-Key (BYOK) stored in chrome.storage.sync
 */

document.addEventListener("DOMContentLoaded", () => {
  const inputApiKey = document.getElementById("input-api-key");
  const btnToggleKey = document.getElementById("btn-toggle-key");
  const inputBackendUrl = document.getElementById("input-backend-url");
  const btnTestBackend = document.getElementById("btn-test-backend");
  const btnSave = document.getElementById("btn-save");
  const btnClearKey = document.getElementById("btn-clear-key");
  const statusAlert = document.getElementById("status-alert");

  // Load existing configuration from chrome.storage.sync
  loadOptions();

  function showAlert(msg, isError = false) {
    statusAlert.textContent = msg;
    statusAlert.className = `alert ${isError ? "alert-error" : "alert-success"}`;
    statusAlert.style.display = "flex";
  }

  function loadOptions() {
    const storage = (chrome.storage && chrome.storage.sync) ? chrome.storage.sync : (chrome.storage ? chrome.storage.local : null);
    if (!storage) return;

    storage.get(["gemini_api_key", "backendUrl"], (items) => {
      if (items) {
        if (items.gemini_api_key) {
          inputApiKey.value = items.gemini_api_key;
        }
        if (items.backendUrl) {
          inputBackendUrl.value = items.backendUrl;
        }
      }
    });
  }

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
    showAlert(`Testing connection to ${candidate}...`, false);

    try {
      const res = await fetch(`${candidate}/health`, { method: "GET" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        showAlert(`✓ Backend reachable! Status: ${data.status || "ok"}`, false);
      } else {
        showAlert(`✗ Backend returned HTTP ${res.status}`, true);
      }
    } catch {
      showAlert(`✗ Cannot connect to ${candidate}. Ensure uvicorn server is running.`, true);
    }
  });

  // Save Settings to chrome.storage.sync
  btnSave.addEventListener("click", async () => {
    const apiKey = inputApiKey.value.trim();
    const backendUrl = inputBackendUrl.value.trim().replace(/\/$/, "");

    const payload = {
      gemini_api_key: apiKey,
      backendUrl: backendUrl || "http://localhost:8000"
    };

    const storage = (chrome.storage && chrome.storage.sync) ? chrome.storage.sync : (chrome.storage ? chrome.storage.local : null);

    if (storage) {
      storage.set(payload, () => {
        // Also mirror to local storage for local fallbacks
        if (chrome.storage && chrome.storage.local && chrome.storage.sync) {
          chrome.storage.local.set(payload);
        }

        const keyMsg = apiKey
          ? "Free Google AI Studio key saved to chrome.storage.sync."
          : "Backend URL saved. Using server's default GEMINI_API_KEY.";

        showAlert(`✓ Settings saved successfully! ${keyMsg}`, false);
      });
    } else {
      showAlert("Notice: Chrome storage is not accessible in this context.", true);
    }
  });

  // Clear Key
  btnClearKey.addEventListener("click", () => {
    inputApiKey.value = "";
    const storage = (chrome.storage && chrome.storage.sync) ? chrome.storage.sync : (chrome.storage ? chrome.storage.local : null);

    if (storage) {
      storage.remove(["gemini_api_key"], () => {
        if (chrome.storage && chrome.storage.local && chrome.storage.sync) {
          chrome.storage.local.remove(["gemini_api_key"]);
        }
        showAlert("Gemini API key removed from sync storage. Requests will use the server default.", false);
      });
    }
  });
});
