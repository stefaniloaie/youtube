# YouTube History Summarizer (Chrome Extension + FastAPI Backend)

Production-ready Chrome Extension (Manifest V3) and Python FastAPI backend that reads a user's cross-device YouTube watch history on demand and synthesizes video transcripts using the Google Gemini API.

---

## 📁 Project Architecture

```
youtube-history-summarizer/
├── manifest.json       # Manifest V3 extension configuration (options_ui + sync storage)
├── background.js      # Service worker: fetches https://www.youtube.com/feed/history
├── popup.html         # Extension popup interface with video checklist & BYOK drawer
├── popup.js           # Client-side extension controller
├── options.html       # BYOK settings page (Google AI Studio Key & server settings)
├── options.js         # Options controller using chrome.storage.sync
├── main.py            # FastAPI backend (delegates BYOK gemini_api_key to Gemini 2.5 Flash)
└── requirements.txt   # Python dependencies
```

---

## 🔑 Bring Your Own Key (BYOK) Architecture

To eliminate ongoing LLM server costs for public users, the extension implements a zero-cost **Bring Your Own Key** model:

1. **User Storage**: Users enter their personal free Google AI Studio key. The extension stores it in `chrome.storage.sync`, automatically synchronizing across all signed-in Chrome browsers.
2. **API Delegation**: When summarizing, the extension forwards the key via the `gemini_api_key` header (and payload parameter) to the FastAPI server.
3. **Free Quota Execution**: The FastAPI server initializes `genai.Client(api_key=gemini_api_key)` and invokes `gemini-2.5-flash` using the user's free tier quota (15 RPM, zero cost to server operators). If omitted, the server can fall back to its internal `GEMINI_API_KEY`.
4. **Options Page**: Accessible via Chrome Extension Options (`chrome://extensions` → Details → Extension options) or by clicking **Options Page ↗** in the popup.

---

## 🚀 Quickstart Guide

### 1. Start the FastAPI Backend

1. Navigate to the project directory:
   ```bash
   cd youtube-history-summarizer
   ```

2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate   # On Windows use: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Configure your Google Gemini API key:
   ```bash
   export GEMINI_API_KEY="your-gemini-api-key-here"
   # On Windows PowerShell:
   # $env:GEMINI_API_KEY="your-gemini-api-key-here"
   ```

4. Launch the FastAPI server on port 8000:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   Verify it is running by checking `https://youtube-production-9f45.up.railway.app/health`.

---

### 2. Load the Extension into Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top right corner.
3. Click **Load unpacked** in the top left.
4. Select the `youtube-history-summarizer` folder.
5. The **YouTube History Digest** icon will appear in your Chrome toolbar.

---

### 3. Usage Workflow

1. Ensure you are signed into your account on [youtube.com](https://www.youtube.com).
2. Click the extension icon in Chrome.
3. The popup automatically fetches and displays all videos watched **Today** with interactive checkboxes:
   - Each row displays the video thumbnail, title, channel name, and duration badge.
   - Use **Select All** or **Deselect All** to adjust your batch, or check/uncheck individual videos.
   - Use the filter dropdown to switch to **Yesterday** or **All Recent History**.
4. **Custom Gemini API Key (Optional)**:
   - Click **⚙️ Settings & API Key** at the bottom of the popup.
   - Enter your own Gemini API key (from [Google AI Studio](https://aistudio.google.com/app/apikey)).
   - Click **Save All Settings**. The key is stored securely in Chrome's local storage and passed directly to your backend requests.
   - If left blank, the backend will use its default `GEMINI_API_KEY` environment variable.
5. Click **✨ Summarize X Selected Videos**.
   - The extension sends your selected videos (and optional custom API key) to `https://youtube-production-9f45.up.railway.app/api/summarize`.
   - Transcripts are fetched via `youtube-transcript-api` and synthesized with Google Gemini.
6. Review the structured Markdown digest and click **Copy Markdown** to copy to your clipboard.
