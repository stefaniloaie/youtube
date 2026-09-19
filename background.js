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
    return true;
  }

  if (request.action === "DEBUG_FETCH") {
    fetch("https://www.youtube.com/feed/history", {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    })
      .then(r => r.text())
      .then(html => {
        const hasYtData = html.includes("ytInitialData");
        const markers = [
          "var ytInitialData = {",
          "var ytInitialData={",
          "window[\"ytInitialData\"] = {",
          "ytInitialData = {",
          "ytInitialData={"
        ];
        const found = markers.filter(m => html.includes(m));
        const ytData = extractYtInitialData(html);
        const hasSectionList = !!ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs;
        sendResponse({
          htmlLength: html.length,
          hasYtData,
          markersFound: found,
          ytDataParsed: !!ytData,
          hasSectionList,
          snippet: html.slice(html.indexOf("ytInitialData"), html.indexOf("ytInitialData") + 200)
        });
      })
      .catch(e => sendResponse({ error: e.message }));
    return true;
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
 * Extracts and parses the ytInitialData JSON object from raw HTML using a robust bracket-counting scanner.
 * Avoids regex pitfalls where non-greedy patterns terminate on early nested braces.
 */
function extractYtInitialData(html) {
  if (!html || typeof html !== "string") return null;

  // Search patterns for where ytInitialData assignment begins
  const candidateMarkers = [
    "var ytInitialData = {",
    "var ytInitialData={",
    "window[\"ytInitialData\"] = {",
    "window[\"ytInitialData\"]={",
    "window['ytInitialData'] = {",
    "window['ytInitialData']={",
    "ytInitialData = {",
    "ytInitialData={"
  ];

  for (const marker of candidateMarkers) {
    let searchPos = 0;
    while (searchPos < html.length) {
      const markerIndex = html.indexOf(marker, searchPos);
      if (markerIndex === -1) break;

      const braceIndex = html.indexOf("{", markerIndex);
      if (braceIndex !== -1) {
        const jsonStr = extractBalancedJsonObject(html, braceIndex);
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed === "object") {
              return parsed;
            }
          } catch (e) {
            console.warn("Bracket scanner found JSON fragment that failed JSON.parse:", e);
          }
        }
      }
      searchPos = markerIndex + marker.length;
    }
  }

  // Regex-assisted fallback to find ytInitialData assignment start index
  const regexPattern = /(?:var\s+|window\[['"]ytInitialData['"]\]\s*=\s*|ytInitialData\s*=\s*)\{/g;
  let match;
  while ((match = regexPattern.exec(html)) !== null) {
    const braceIndex = html.indexOf("{", match.index);
    if (braceIndex !== -1) {
      const jsonStr = extractBalancedJsonObject(html, braceIndex);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        } catch (e) {
          console.warn("Regex-assisted bracket parse error:", e);
        }
      }
    }
  }

  return null;
}

/**
 * Extracts a balanced JSON string starting from startIndex (which must point to '{').
 * Properly handles escaped characters and nested quote strings.
 */
function extractBalancedJsonObject(str, startIndex) {
  let depth = 0;
  let inString = false;
  let quoteChar = "";
  let isEscaped = false;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (inString) {
      if (char === quoteChar) {
        inString = false;
        quoteChar = "";
      }
    } else {
      if (char === '"' || char === "'") {
        inString = true;
        quoteChar = char;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          return str.slice(startIndex, i + 1);
        }
      }
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
        if (isShortVideo(item, item.videoRenderer)) continue;
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
      if (isShortVideo(node, node.videoRenderer)) return;
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

function isShortVideo(itemNode, vr) {
  // Check reelItemRenderer or shortsLockupViewModel
  if (itemNode.reelItemRenderer || itemNode.shortsLockupViewModel) return true;
  
  // Check navigationEndpoint for /shorts/
  const navUrl = vr?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
  if (navUrl.includes('/shorts/')) return true;

  // Check title hashtags (#shorts, #short)
  let title = '';
  if (vr?.title?.runs) title = vr.title.runs.map(r => r.text).join('');
  else if (vr?.title?.simpleText) title = vr.title.simpleText;
  if (/#shorts|#short/i.test(title)) return true;

  // Check length text (e.g. <= 60 seconds if format like 0:45 or 0:30)
  const lenText = vr?.lengthText?.simpleText || '';
  // if duration is under 60 seconds and has overlay style SHORTS
  const overlays = vr?.thumbnailOverlays || [];
  for (const o of overlays) {
    const style = o?.thumbnailOverlayTimeStatusRenderer?.style;
    if (style === 'SHORTS') return true;
  }

  return false;
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
