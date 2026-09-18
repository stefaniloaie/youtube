/**
 * Background Service Worker for YouTube History Summarizer (Manifest V3)
 * Fetches https://www.youtube.com/feed/history with credentials: "include"
 * and extracts ytInitialData to gather videos grouped by section (Today, Yesterday, etc.)
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_WATCH_HISTORY") {
    handleFetchWatchHistory(request.sectionFilter || "today")
      .then((data) => sendResponse({ success: true, ...data }))
      .catch((error) => {
        console.error("YouTube History Summarizer background error:", error);
        sendResponse({ success: false, error: error.message || "Failed to retrieve YouTube history." });
      });
    return true; // Keep message port open for async response
  }
});

async function handleFetchWatchHistory(sectionFilter = "today") {
  let response;
  try {
    response = await fetch("https://www.youtube.com/feed/history", {
      method: "GET",
      credentials: "include",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } catch (err) {
    throw new Error(`Cannot connect to YouTube (${err.message}). Check your internet connection and verify you can open https://www.youtube.com.`);
  }

  if (!response.ok) {
    throw new Error(`YouTube history page returned HTTP ${response.status}. Please ensure you are logged into YouTube.`);
  }

  const html = await response.text();
  const ytData = extractYtInitialData(html);

  if (!ytData) {
    throw new Error("Could not find ytInitialData in YouTube history page. Please make sure you are signed into YouTube in this browser profile.");
  }

  const { videos, sections, activeSection } = parseWatchHistorySections(ytData, sectionFilter);

  if (!videos || videos.length === 0) {
    throw new Error(
      sectionFilter === "today"
        ? "No videos found for Today in your watch history. If you watched videos today, ensure watch history is not paused."
        : "No recent videos found in your watch history."
    );
  }

  return { videos, sections, activeSection };
}

/**
 * Extracts and parses the ytInitialData JSON object from raw HTML
 */
function extractYtInitialData(html) {
  // Pattern 1: var ytInitialData = {...};
  const regexVar = /var\s+ytInitialData\s*=\s*({.+?});\s*<\/script>/s;
  const matchVar = html.match(regexVar);
  if (matchVar && matchVar[1]) {
    try {
      return JSON.parse(matchVar[1]);
    } catch (e) {
      console.warn("Direct JSON.parse failed on var match:", e);
    }
  }

  // Pattern 2: window["ytInitialData"] = {...};
  const regexWindow = /window\["ytInitialData"\]\s*=\s*({.+?});\s*<\/script>/s;
  const matchWindow = html.match(regexWindow);
  if (matchWindow && matchWindow[1]) {
    try {
      return JSON.parse(matchWindow[1]);
    } catch (e) {
      console.warn("Direct JSON.parse failed on window match:", e);
    }
  }

  // Pattern 3: ytInitialData = {...};
  const regexLoose = /ytInitialData\s*=\s*({.+?});/s;
  const matchLoose = html.match(regexLoose);
  if (matchLoose && matchLoose[1]) {
    try {
      return JSON.parse(matchLoose[1]);
    } catch (e) {
      console.warn("Direct JSON.parse failed on loose match:", e);
    }
  }

  return null;
}

/**
 * Extracts video items organized by sections (Today, Yesterday, etc.)
 */
function parseWatchHistorySections(ytData, requestedFilter = "today") {
  const sectionsFound = [];
  let allVideos = [];
  const seenIds = new Set();

  // Try locating the main sectionListRenderer inside twoColumnBrowseResultsRenderer
  let sectionList = null;
  try {
    const tabs = ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (Array.isArray(tabs) && tabs[0]?.tabRenderer?.content?.sectionListRenderer) {
      sectionList = tabs[0].tabRenderer.content.sectionListRenderer.contents;
    }
  } catch (e) {
    console.warn("Error accessing sectionListRenderer path:", e);
  }

  if (Array.isArray(sectionList) && sectionList.length > 0) {
    for (let i = 0; i < sectionList.length; i++) {
      const sectionNode = sectionList[i]?.itemSectionRenderer;
      if (!sectionNode) continue;

      // Extract section title (e.g. "Today", "Yesterday", "September 17")
      let sectionTitle = "";
      const headerTitleObj = sectionNode.header?.itemSectionHeaderRenderer?.title;
      if (headerTitleObj) {
        if (headerTitleObj.simpleText) {
          sectionTitle = headerTitleObj.simpleText;
        } else if (Array.isArray(headerTitleObj.runs) && headerTitleObj.runs[0]?.text) {
          sectionTitle = headerTitleObj.runs.map((r) => r.text).join("");
        }
      }

      if (!sectionTitle) {
        sectionTitle = i === 0 ? "Today" : `Day ${i + 1}`;
      }

      const sectionVideos = [];
      const contents = sectionNode.contents || [];

      for (const item of contents) {
        if (item.videoRenderer && item.videoRenderer.videoId) {
          const v = formatVideoItem(item.videoRenderer, sectionTitle);
          if (v && !seenIds.has(v.videoId)) {
            seenIds.add(v.videoId);
            sectionVideos.push(v);
          }
        }
      }

      if (sectionVideos.length > 0) {
        sectionsFound.push({
          title: sectionTitle,
          isToday: i === 0 || /today/i.test(sectionTitle),
          count: sectionVideos.length,
          videos: sectionVideos
        });
        allVideos = allVideos.concat(sectionVideos);
      }
    }
  }

  // Fallback: If structured section list wasn't found, traverse the whole object
  if (allVideos.length === 0) {
    const fallbackVideos = [];
    function traverse(node) {
      if (!node || typeof node !== "object" || fallbackVideos.length >= 30) return;
      if (node.videoRenderer && node.videoRenderer.videoId) {
        const v = formatVideoItem(node.videoRenderer, "Today");
        if (v && !seenIds.has(v.videoId)) {
          seenIds.add(v.videoId);
          fallbackVideos.push(v);
        }
        return;
      }
      for (const key of Object.keys(node)) {
        if (fallbackVideos.length >= 30) break;
        traverse(node[key]);
      }
    }
    traverse(ytData);

    if (fallbackVideos.length > 0) {
      sectionsFound.push({
        title: "Today",
        isToday: true,
        count: fallbackVideos.length,
        videos: fallbackVideos
      });
      allVideos = fallbackVideos;
    }
  }

  // Decide which videos to return based on requested filter
  if (requestedFilter === "today") {
    const todaySection = sectionsFound.find((s) => s.isToday) || sectionsFound[0];
    if (todaySection && todaySection.videos.length > 0) {
      return {
        videos: todaySection.videos,
        sections: sectionsFound.map((s) => ({ title: s.title, count: s.count, isToday: s.isToday })),
        activeSection: todaySection.title
      };
    }
  }

  // If specific section requested
  const matchedSection = sectionsFound.find((s) => s.title.toLowerCase() === requestedFilter.toLowerCase());
  if (matchedSection) {
    return {
      videos: matchedSection.videos,
      sections: sectionsFound.map((s) => ({ title: s.title, count: s.count, isToday: s.isToday })),
      activeSection: matchedSection.title
    };
  }

  // Default: all recent videos
  return {
    videos: allVideos,
    sections: sectionsFound.map((s) => ({ title: s.title, count: s.count, isToday: s.isToday })),
    activeSection: "All Recent"
  };
}

function formatVideoItem(vr, sectionTitle) {
  const videoId = vr.videoId;
  if (!videoId) return null;

  // Title
  let title = "Untitled Video";
  if (vr.title) {
    if (Array.isArray(vr.title.runs) && vr.title.runs.length > 0) {
      title = vr.title.runs.map((r) => r.text).join("");
    } else if (vr.title.simpleText) {
      title = vr.title.simpleText;
    }
  }

  // Channel
  let channel = "";
  if (vr.shortBylineText && Array.isArray(vr.shortBylineText.runs)) {
    channel = vr.shortBylineText.runs.map((r) => r.text).join("");
  } else if (vr.ownerText && Array.isArray(vr.ownerText.runs)) {
    channel = vr.ownerText.runs.map((r) => r.text).join("");
  }

  // Duration
  let duration = "";
  if (vr.lengthText && vr.lengthText.simpleText) {
    duration = vr.lengthText.simpleText;
  }

  // Thumbnail
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (vr.thumbnail && Array.isArray(vr.thumbnail.thumbnails) && vr.thumbnail.thumbnails.length > 0) {
    // Pick standard medium thumbnail
    const thumbs = vr.thumbnail.thumbnails;
    thumbnail = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || thumbnail;
  }

  return {
    videoId,
    title: title.trim(),
    channel: channel.trim(),
    duration: duration.trim(),
    thumbnail,
    section: sectionTitle,
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}
