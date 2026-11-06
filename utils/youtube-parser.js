/**
 * YouTube Parser & Navigation Utility for Siddarth AI Browser Assistant
 * Handles:
 * 1. YouTube URL detection (watch, shorts, embed, youtu.be)
 * 2. Video ID and timestamp parsing ([MM:SS], [HH:MM:SS])
 * 3. In-tab YouTube metadata and DOM chapter extraction
 * 4. Timed transcript / caption parsing (XML & JSON3 formats)
 * 5. Interactive clickable timestamp rendering and tab player seeking
 */

/**
 * Checks if a given URL is a YouTube domain
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url);
}

/**
 * Checks if a URL points to a specific watchable video
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubeWatchUrl(url) {
  if (!isYouTubeUrl(url)) return false;
  return /(?:watch\?.*v=|youtu\.be\/|shorts\/|embed\/|v\/)/i.test(url);
}

/**
 * Extracts the 11-character YouTube video ID from various URL formats
 * @param {string} url
 * @returns {string|null}
 */
export function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);

    // 1. youtube.com/watch?v=VIDEO_ID
    if (parsed.searchParams.has('v')) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }
    }

    // 2. youtu.be/VIDEO_ID
    if (parsed.hostname === 'youtu.be' || parsed.hostname.endsWith('.youtu.be')) {
      const id = parsed.pathname.slice(1).split('/')[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return id;
      }
    }

    // 3. youtube.com/shorts/VIDEO_ID or /embed/VIDEO_ID or /v/VIDEO_ID
    const pathMatch = parsed.pathname.match(/\/(shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
    if (pathMatch && pathMatch[2]) {
      return pathMatch[2];
    }
  } catch {
    // Fallback to regex if URL constructor fails
    const match = url.match(/(?:v=|youtu\.be\/|\/(?:shorts|embed|v)\/)([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Parses timestamp string into total seconds
 * Supports: "01:23", "1:23", "01:05:30", "1:05:30", "83s", "1m23s", "1h5m30s"
 * @param {string|number} timeStr
 * @returns {number}
 */
export function parseTimestampToSeconds(timeStr) {
  if (typeof timeStr === 'number') {
    return Math.max(0, Math.floor(timeStr));
  }

  if (!timeStr || typeof timeStr !== 'string') return 0;

  const clean = timeStr.trim().replace(/[\[\]\(\)]/g, '');

  // Format: HH:MM:SS or MM:SS or M:SS
  if (clean.includes(':')) {
    const parts = clean.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;

    if (parts.length === 3) {
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
      const [m, s] = parts;
      return m * 60 + s;
    }
  }

  // Format: 1h2m3s or 2m15s or 90s
  const hourMatch = clean.match(/(\d+)\s*h/i);
  const minMatch = clean.match(/(\d+)\s*m/i);
  const secMatch = clean.match(/(\d+)\s*s/i);

  if (hourMatch || minMatch || secMatch) {
    let total = 0;
    if (hourMatch) total += parseInt(hourMatch[1], 10) * 3600;
    if (minMatch) total += parseInt(minMatch[1], 10) * 60;
    if (secMatch) total += parseInt(secMatch[1], 10);
    return total;
  }

  // Pure numeric seconds
  const numeric = parseFloat(clean);
  return isNaN(numeric) ? 0 : Math.max(0, Math.floor(numeric));
}

/**
 * Formats seconds into standard timestamp string (MM:SS or HH:MM:SS)
 * @param {number} seconds
 * @returns {string}
 */
export function formatSecondsToTimestamp(seconds) {
  const secs = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  if (h > 0) {
    const hh = String(h).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

/**
 * Extracts chapters and timestamps from video description text
 * Matches patterns like:
 * "00:00 - Introduction"
 * "01:45 Setting up the project"
 * "[03:20] Architecture overview"
 * @param {string} text
 * @returns {Array<{seconds: number, timeStr: string, title: string}>}
 */
export function extractChaptersFromText(text) {
  if (!text || typeof text !== 'string') return [];

  const chapters = [];
  const lines = text.split('\n');

  // Regex matches timestamp at start of line or after common bullet/bracket
  const chapterRegex = /(?:^|\s|\b)(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))?\s*[-–—:]?\s*(.+)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(chapterRegex);
    if (match) {
      const timeStr = match[1];
      const title = match[2]?.trim().replace(/^[-–—:]\s*/, '') || 'Chapter';
      const seconds = parseTimestampToSeconds(timeStr);

      // Filter out non-chapter spurious matches
      if (title.length >= 2 && title.length <= 120) {
        chapters.push({
          seconds,
          timeStr,
          title
        });
      }
    }
  }

  // Deduplicate and sort chronologically
  return chapters
    .filter((ch, index, self) => index === self.findIndex(c => c.seconds === ch.seconds))
    .sort((a, b) => a.seconds - b.seconds);
}

/**
 * Parses YouTube timedtext XML format
 * Format: <transcript><text start="1.23" dur="4.56">Subtitle text</text></transcript>
 * @param {string} xmlString
 * @returns {Array<{start: number, duration: number, timeStr: string, text: string}>}
 */
export function parseTimedTextXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') return [];

  const segments = [];
  // Regex to extract <text start="..." dur="...">content</text>
  const textTagRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>(.*?)<\/text>/gi;
  let match;

  while ((match = textTagRegex.exec(xmlString)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const duration = parseFloat(match[2]) || 0;
    let text = match[3] || '';

    // Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n/g, ' ')
      .trim();

    if (text) {
      segments.push({
        start: Math.round(start * 10) / 10,
        duration: Math.round(duration * 10) / 10,
        timeStr: formatSecondsToTimestamp(start),
        text
      });
    }
  }

  return segments;
}

/**
 * Parses YouTube timedtext json3 format
 * Format: { events: [ { tStartMs: 0, dDurationMs: 1200, segs: [ { utf8: "text" } ] } ] }
 * @param {object|string} jsonInput
 * @returns {Array<{start: number, duration: number, timeStr: string, text: string}>}
 */
export function parseTimedTextJson3(jsonInput) {
  let data = jsonInput;
  if (typeof jsonInput === 'string') {
    try {
      data = JSON.parse(jsonInput);
    } catch {
      return [];
    }
  }

  if (!data?.events || !Array.isArray(data.events)) return [];

  const segments = [];
  for (const ev of data.events) {
    if (!ev.segs || !Array.isArray(ev.segs)) continue;

    const startSec = (ev.tStartMs || 0) / 1000;
    const durSec = (ev.dDurationMs || 0) / 1000;
    const text = ev.segs.map(s => s.utf8 || '').join('').trim();

    if (text && text !== '\n') {
      segments.push({
        start: Math.round(startSec * 10) / 10,
        duration: Math.round(durSec * 10) / 10,
        timeStr: formatSecondsToTimestamp(startSec),
        text
      });
    }
  }

  return segments;
}

/**
 * Groups raw subtitle segments into timestamped paragraphs
 * (e.g. grouped every 45-60 seconds) for clean LLM prompt conditioning.
 * @param {Array} segments
 * @param {number} groupIntervalSecs
 * @param {number} maxCharLength
 * @returns {{transcriptText: string, segmentsCount: number, durationMinutes: number}}
 */
export function groupTranscriptSegments(segments, groupIntervalSecs = 50, maxCharLength = 22000) {
  if (!segments || segments.length === 0) {
    return { transcriptText: '', segmentsCount: 0, durationMinutes: 0 };
  }

  const grouped = [];
  let currentGroup = null;

  for (const seg of segments) {
    const bucket = Math.floor(seg.start / groupIntervalSecs) * groupIntervalSecs;

    if (!currentGroup || currentGroup.bucket !== bucket) {
      if (currentGroup) {
        grouped.push(currentGroup);
      }
      currentGroup = {
        bucket,
        timeStr: formatSecondsToTimestamp(bucket),
        texts: [seg.text]
      };
    } else {
      currentGroup.texts.push(seg.text);
    }
  }

  if (currentGroup) {
    grouped.push(currentGroup);
  }

  const lines = grouped.map(g => `[${g.timeStr}] ${g.texts.join(' ')}`);
  let fullText = lines.join('\n\n');

  const lastSeg = segments[segments.length - 1];
  const totalDurationMinutes = Math.round((lastSeg.start + (lastSeg.duration || 0)) / 60);

  // Text clamping if exceeds max token budget
  if (fullText.length > maxCharLength) {
    const headLimit = Math.floor(maxCharLength * 0.6);
    const tailLimit = Math.floor(maxCharLength * 0.35);

    const head = fullText.slice(0, headLimit);
    const tail = fullText.slice(fullText.length - tailLimit);

    fullText = `${head}\n\n[... transcript truncated for length ...]\n\n${tail}`;
  }

  return {
    transcriptText: fullText,
    segmentsCount: segments.length,
    durationMinutes: totalDurationMinutes
  };
}

/**
 * In-tab extraction function designed to be injected via chrome.scripting.executeScript
 * Gathers video metadata, DOM chapters, description, and available caption tracks.
 */
export function extractYouTubePageDataInTab() {
  const result = {
    url: window.location.href,
    title: '',
    channel: '',
    duration: 0,
    currentTime: 0,
    description: '',
    domChapters: [],
    captionTracks: []
  };

  // 1. Video element details
  const video = document.querySelector('video');
  if (video) {
    result.duration = Math.round(video.duration || 0);
    result.currentTime = Math.round(video.currentTime || 0);
  }

  // 2. Video Title
  const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                  document.querySelector('#title h1 yt-formatted-string') ||
                  document.querySelector('meta[name="title"]');
  if (titleEl) {
    result.title = titleEl.textContent?.trim() || titleEl.getAttribute('content')?.trim() || '';
  }
  if (!result.title) {
    result.title = document.title.replace(/ - YouTube$/, '').trim();
  }

  // 3. Channel Name
  const channelEl = document.querySelector('ytd-channel-name yt-formatted-string a') ||
                    document.querySelector('#channel-name #text a') ||
                    document.querySelector('link[itemprop="name"]');
  if (channelEl) {
    result.channel = channelEl.textContent?.trim() || channelEl.getAttribute('content')?.trim() || '';
  }

  // 4. Description
  const descEl = document.querySelector('#description-inline-expander') ||
                 document.querySelector('#description-inner') ||
                 document.querySelector('meta[name="description"]');
  if (descEl) {
    result.description = descEl.innerText?.trim() || descEl.getAttribute('content')?.trim() || '';
  }

  // 5. Native DOM macro-markers / chapters if rendered by YouTube
  const chapterItems = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
  chapterItems.forEach(item => {
    const timeEl = item.querySelector('#time');
    const titleEl = item.querySelector('#details h4');
    if (timeEl && titleEl) {
      result.domChapters.push({
        timeStr: timeEl.textContent.trim(),
        title: titleEl.textContent.trim()
      });
    }
  });

  // 6. Caption tracks from window or DOM script tags
  let playerResponse = null;

  if (window.ytInitialPlayerResponse) {
    playerResponse = window.ytInitialPlayerResponse;
  } else {
    // Search scripts for embedded JSON
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('ytInitialPlayerResponse')) {
        const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match && match[1]) {
          try {
            playerResponse = JSON.parse(match[1]);
            break;
          } catch {}
        }
      }
    }
  }

  if (playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
    result.captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks.map(t => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      kind: t.kind || 'standard',
      isTranslatable: Boolean(t.isTranslatable)
    }));
  }

  return result;
}

/**
 * Fetches and parses caption track from YouTube timedtext URL
 * Tries JSON3 format first, falls back to XML.
 * @param {string} baseUrl
 * @returns {Promise<Array<{start: number, duration: number, timeStr: string, text: string}>>}
 */
export async function fetchCaptionTrack(baseUrl) {
  if (!baseUrl) return [];

  // Try JSON3 format first
  try {
    const jsonUrl = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;
    const response = await fetch(jsonUrl);
    if (response.ok) {
      const data = await response.json();
      const segments = parseTimedTextJson3(data);
      if (segments.length > 0) {
        return segments;
      }
    }
  } catch (err) {
    console.warn('[Siddarth] JSON3 timedtext fetch failed, trying XML format:', err);
  }

  // Fallback to XML format
  try {
    const xmlUrl = baseUrl.replace('&fmt=json3', '');
    const response = await fetch(xmlUrl);
    if (response.ok) {
      const xmlText = await response.text();
      return parseTimedTextXml(xmlText);
    }
  } catch (err) {
    console.warn('[Siddarth] XML timedtext fetch failed:', err);
  }

  return [];
}

/**
 * Replaces timestamps in rendered markdown/HTML with interactive clickable buttons
 * Matches patterns like:
 * "[01:45]" or "(01:45)" or "- 01:45"
 * Transforms into:
 * <button type="button" class="yt-timestamp-btn" data-seconds="105" data-timestr="01:45" title="Jump video to 01:45">01:45</button>
 * @param {string} html
 * @returns {string}
 */
export function renderClickableTimestamps(html) {
  if (!html || typeof html !== 'string') return '';

  // Regex matches timestamps like [01:45], [01:05:30], (01:45), or freestanding timestamps
  // Avoid replacing inside existing HTML tags or attributes
  const timestampRegex = /(?:\[|\()(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))/g;

  return html.replace(timestampRegex, (fullMatch, timeStr) => {
    const seconds = parseTimestampToSeconds(timeStr);
    return `<button type="button" class="yt-timestamp-btn" data-seconds="${seconds}" data-timestr="${timeStr}" title="Jump video to ${timeStr}">[${timeStr}]</button>`;
  });
}

/**
 * Seeks the video element in the active tab to the specified seconds
 * Injected into the active tab via chrome.scripting.executeScript
 * @param {number} targetSeconds
 * @returns {{success: boolean, currentTime: number, duration: number, error?: string}}
 */
export function seekVideoInPage(targetSeconds) {
  const video = document.querySelector('video');
  if (!video) {
    return { success: false, currentTime: 0, duration: 0, error: 'No HTML5 video player found on this page.' };
  }

  try {
    video.currentTime = targetSeconds;
    if (video.paused) {
      video.play().catch(() => {});
    }
    return {
      success: true,
      currentTime: video.currentTime,
      duration: video.duration || 0
    };
  } catch (err) {
    return {
      success: false,
      currentTime: video.currentTime,
      duration: video.duration || 0,
      error: err.message
    };
  }
}

