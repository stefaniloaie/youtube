/**
 * YouTube History Summarizer - Full Screen Report Viewer
 */

document.addEventListener("DOMContentLoaded", () => {
  const reportContent = document.getElementById("report-content");
  const reportTimestamp = document.getElementById("report-timestamp");
  const metaStats = document.getElementById("meta-stats");
  const pillVideos = document.getElementById("pill-videos");
  const btnCopy = document.getElementById("btn-copy-report");
  const btnDownload = document.getElementById("btn-download-md");
  const btnClose = document.getElementById("btn-close-tab");
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");

  let rawMarkdown = "";

  function showToast(msg) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = msg;
    toast.style.display = "flex";
    setTimeout(() => {
      toast.style.display = "none";
    }, 2500);
  }

  function parseMarkdown(md) {
    if (!md) return "";
    let html = md;

    html = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^# (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/gim, "<code>$1</code>");
    html = html.replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\s*)+)/gim, "<ul>$1</ul>");

    const paragraphs = html.split(/\n\n+/);
    html = paragraphs
      .map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return "";
        if (
          trimmed.startsWith("<h2") ||
          trimmed.startsWith("<h3") ||
          trimmed.startsWith("<ul")
        ) {
          return trimmed;
        }
        return "<p>" + trimmed.replace(/\n/g, "<br/>") + "</p>";
      })
      .join("");

    return html;
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(
      ["latestSummary", "latestSummaryTimestamp", "latestSummaryVideosCount"],
      (data) => {
        const summaryText = data.latestSummary || "";
        rawMarkdown = summaryText;

        if (summaryText && reportContent) {
          reportContent.innerHTML = parseMarkdown(summaryText);

          const timeStr =
            data.latestSummaryTimestamp || new Date().toLocaleString();
          if (reportTimestamp) {
            reportTimestamp.textContent = "Synthesized on " + timeStr;
          }

          const count =
            data.latestSummaryVideosCount ||
            (summaryText.match(/### /g) || []).length ||
            1;
          if (pillVideos) {
            pillVideos.textContent = count + " Video" + (count === 1 ? "" : "s");
          }
          if (metaStats) {
            metaStats.textContent =
              "Full Intelligence Synthesis • " +
              count +
              " video transcript" +
              (count === 1 ? "" : "s") +
              " processed";
          }
        } else if (reportContent) {
          reportContent.innerHTML =
            "<div class=\"empty-state\"><h3>No summary found in storage</h3><p>Please open the YouTube History Summarizer extension popup, select your watched videos, and click \"Summarize\".</p></div>";
        }
      }
    );
  } else if (reportContent) {
    reportContent.innerHTML =
      "<div class=\"empty-state\"><h3>Running in Standalone Preview</h3><p>This report viewer automatically displays digests stored in <code>chrome.storage.local.latestSummary</code>.</p></div>";
  }

  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      if (!rawMarkdown) {
        showToast("No summary to copy!");
        return;
      }
      try {
        await navigator.clipboard.writeText(rawMarkdown);
        showToast("✓ Summary copied to clipboard!");
      } catch (err) {
        console.error("Clipboard copy error:", err);
        showToast("Copy failed.");
      }
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      if (!rawMarkdown) {
        showToast("No summary to download!");
        return;
      }
      const blob = new Blob([rawMarkdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateTag = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = "youtube-history-summary-" + dateTag + ".md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("✓ Download started!");
    });
  }

  if (btnClose) {
    btnClose.addEventListener("click", () => {
      window.close();
    });
  }
});
