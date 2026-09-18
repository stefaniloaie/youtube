# YouTube History Summarizer (Chrome Extension + FastAPI Backend)

## Setup:
1. Start the FastAPI backend:
   pip install -r requirements.txt
   export GEMINI_API_KEY="your_api_key_here"
   uvicorn main:app --reload --port 8000

2. In Google Chrome:
   - Navigate to chrome://extensions
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select THIS folder (ensure manifest.json is directly in the selected folder)
