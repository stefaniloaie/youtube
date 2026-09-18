"""
FastAPI Backend for YouTube History Summarizer
Extracts video transcripts and synthesizes them using the Google GenAI SDK (Gemini).
"""

import os
from typing import List, Optional, Union
from fastapi import FastAPI, HTTPException, Body, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="YouTube History Summarizer API",
    description="Backend service for fetching video transcripts and summarizing with Gemini.",
    version="1.0.0",
)

# Enable CORS for Chrome Extension access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data Models
class VideoItem(BaseModel):
    model_config = {"extra": "ignore"}
    videoId: str = Field(..., description="YouTube 11-character video ID")
    title: str = Field(default="Untitled Video", description="Video title")
    url: Optional[str] = Field(default=None, description="Direct URL to the video")
    channel: Optional[str] = None
    duration: Optional[str] = None

class SummarizeRequest(BaseModel):
    model_config = {"extra": "ignore"}
    videos: List[VideoItem]
    gemini_api_key: Optional[str] = Field(
        default=None,
        description="Free Google AI Studio key passed by user under BYOK architecture."
    )
    apiKey: Optional[str] = Field(
        default=None,
        description="Optional alias for gemini_api_key."
    )

class SummarizeResponse(BaseModel):
    digest: str
    totalVideos: int
    transcriptsAvailable: int
    transcriptsUnavailable: int

SYSTEM_INSTRUCTION = """<system_role>
You are an expert content intelligence synthesizer. Your task is to process a bundle of raw YouTube video transcripts from a user's watch history and produce a clean, structured digest.
</system_role>

<input_format>
You will receive input containing one or more video transcripts formatted as follows:

--- VIDEO: [Video Title] ---
[Raw Transcript Text or Transcript Unavailable]
</input_format>

<output_requirements>
Generate a response in valid Markdown with the following exact structure:

## 📊 Executive Overview
A concise 2-3 sentence synthesis identifying overarching themes, common topics, or distinct learning categories across all processed videos.

## 📹 Video Summaries

For each video provided in the input:

### 1. [Video Title]
- **Core Takeaway:** A 1-sentence summary of the main point.
- **Key Points:**
  - [Key detail or actionable insight 1]
  - [Key detail or actionable insight 2]
  - [Key detail or actionable insight 3]

(Repeat the `### N. [Video Title]` structure for every video in the batch).
</output_requirements>

<constraints>
1. ACCURACY: Base your summaries STRICTLY on the provided transcript text. Do not hallucinate external details or assume content not present in the text.
2. MISSING TRANSCRIPTS: If a transcript is marked as `[Transcript Unavailable]`, output:
   - **Core Takeaway:** Transcript was unavailable for processing.
   - **Key Points:** N/A
3. NO FLUFF: Skip introductory setup phrases (e.g., "Here is your summary"). Start directly with the `## 📊 Executive Overview` header.
4. BREVITY: Keep key points punchy, concrete, and focused on value density. Avoid conversational fluff.
</constraints>"""

def fetch_single_transcript(video_id: str) -> tuple[str, bool]:
    """
    Fetches transcript text using youtube-transcript-api.
    Returns (transcript_text, is_available).
    """
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(
            video_id, languages=["en", "en-US", "en-GB", "es", "de", "fr"]
        )
        # Join transcript chunks into cohesive prose
        lines = [item.get("text", "").strip() for item in transcript_list if item.get("text")]
        full_text = " ".join(lines).strip()
        if not full_text:
            return ("[Transcript Unavailable]", False)
        return (full_text, True)
    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable):
        return ("[Transcript Unavailable]", False)
    except Exception as exc:
        # Fallback for regional or network exceptions
        print(f"Warning: Transcript fetch failed for {video_id}: {exc}")
        return ("[Transcript Unavailable]", False)

def get_genai_client(custom_api_key: Optional[str] = None) -> genai.Client:
    """
    Initializes a Gemini client using the user's custom key if provided,
    otherwise falls back to the server's GEMINI_API_KEY environment variable.
    """
    api_key = (custom_api_key or "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Gemini API key is required. Please enter your Gemini API key in the extension "
                "settings or configure GEMINI_API_KEY in the backend server."
            ),
        )
    return genai.Client(api_key=api_key)

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "has_api_key": bool(os.getenv("GEMINI_API_KEY")),
        "service": "YouTube History Summarizer API"
    }

@app.post("/api/summarize", response_model=SummarizeResponse)
def summarize_history(
    payload: Union[SummarizeRequest, List[VideoItem]] = Body(...),
    gemini_api_key: Optional[str] = Header(None, alias="gemini_api_key"),
    x_gemini_api_key: Optional[str] = Header(None, alias="x-gemini-api-key"),
):
    # Normalize input whether sent as header, { "videos": [...], "gemini_api_key": "..." } or raw [...]
    videos: List[VideoItem] = []
    user_api_key: Optional[str] = gemini_api_key or x_gemini_api_key

    if isinstance(payload, SummarizeRequest):
        videos = payload.videos
        if payload.gemini_api_key and payload.gemini_api_key.strip():
            user_api_key = payload.gemini_api_key.strip()
        elif payload.apiKey and payload.apiKey.strip():
            user_api_key = payload.apiKey.strip()
    else:
        videos = payload

    if not videos:
        raise HTTPException(status_code=400, detail="No video items were provided in the request.")

    bundle_parts = []
    available_count = 0
    unavailable_count = 0

    # 1. Fetch transcripts for all videos
    for item in videos:
        title = item.title.strip() or f"Video {item.videoId}"
        transcript_text, is_available = fetch_single_transcript(item.videoId)

        if is_available:
            available_count += 1
        else:
            unavailable_count += 1

        bundle_parts.append(f"--- VIDEO: {title} ---\n{transcript_text}")

    full_bundle = "\n\n".join(bundle_parts)

    # 2. Invoke Google GenAI Gemini Model with user key or environment key
    client = get_genai_client(user_api_key)

    # Candidate models prioritized: gemini-2.5-flash as the ideal shared default, with graceful fallbacks
    models_to_try = [
        os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "gemini-1.5-flash",
        "gemini-3.8-flash",
        "gemini-3.1-flash-lite",
    ]

    last_error = None
    digest_text = ""

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=full_bundle,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.2,
                ),
            )
            if response and response.text:
                digest_text = response.text
                break
        except Exception as err:
            print(f"Model {model_name} failed: {err}")
            last_error = err

    if not digest_text:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API generation failed: {last_error}",
        )

    return SummarizeResponse(
        digest=digest_text,
        totalVideos=len(videos),
        transcriptsAvailable=available_count,
        transcriptsUnavailable=unavailable_count,
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main.py:app", host="0.0.0.0", port=8000, reload=True)
