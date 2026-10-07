// Service worker: holds the allow-list, the alternative-suggestion engine,
// and a rolling memory of problems the user faced per site.

const SUGGESTIONS = {
  // host -> alternative sites/apps with similar content
  "youtube.com": ["vimeo.com", "dailymotion.com", "nebula.tv"],
  "vimeo.com": ["youtube.com", "dailymotion.com"],
  "netflix.com": ["amazonprimevideo.com", "hulu.com", "disneyplus.com", "appletv.apple.com"],
  "amazon.com": ["walmart.com", "ebay.com", "target.com", "bestbuy.com"],
  "ebay.com": ["amazon.com", "etsy.com"],
  "etsy.com": ["ebay.com", "amazonhandmade.com"],
  "twitter.com": ["mastodon.social", "bsky.app", "threads.net"],
  "x.com": ["mastodon.social", "bsky.app", "threads.net"],
  "instagram.com": ["vsco.co", "tiktok.com", "pinterest.com"],
  "tiktok.com": ["instagram.com", "youtube.com/shorts"],
  "facebook.com": ["reddit.com", "discord.com"],
  "reddit.com": ["news.ycombinator.com", "lemmy.world"],
  "google.com": ["bing.com", "duckduckgo.com", "brave.com/search"],
  "bing.com": ["google.com", "duckduckgo.com"],
  "stackexchange.com": ["stackoverflow.com"],
  "stackoverflow.com": ["stackexchange.com", "github.com/discussions"],
  "github.com": ["gitlab.com", "bitbucket.org"],
  "gitlab.com": ["github.com", "bitbucket.org"],
  "spotify.com": ["music.apple.com", "soundcloud.com", "youtubemusic.com"],
  "soundcloud.com": ["spotify.com", "bandcamp.com"],
  "wikipedia.org": ["britannica.com", "simple.wikipedia.org"],
  "amazon.in": ["flipkart.com", "myntra.com"],
  "flipkart.com": ["amazon.in", "meesho.com"]
};

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function isAllowed(host, allowlist) {
  return allowlist.some((a) => host === a || host.endsWith("." + a));
}

function alternativesFor(host) {
  if (SUGGESTIONS[host]) return SUGGESTIONS[host];
  const key = Object.keys(SUGGESTIONS).find((k) => host.endsWith("." + k) || host === k);
  return key ? SUGGESTIONS[key] : [];
}

// Keep a short rolling log of problems per host so repeated issues get noticed.
async function recordProblem(host, problem) {
  const { problems = {} } = await chrome.storage.local.get("problems");
  const arr = problems[host] || [];
  arr.push({ type: problem, at: Date.now() });
  problems[host] = arr.slice(-30); // keep last 30
  await chrome.storage.local.set({ problems });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "CAN_MONITOR") {
      const { allowlist = [], enabled = true } = await chrome.storage.local.get(["allowlist", "enabled"]);
      const host = hostOf(msg.url);
      sendResponse({ allowed: enabled && isAllowed(host, allowlist) });
      return;
    }

    if (msg.type === "FRUSTRATION_EVENT") {
      const host = hostOf(msg.url);
      await recordProblem(host, msg.reason);
      const alts = alternativesFor(host);
      const { problems = {} } = await chrome.storage.local.get("problems");
      const recent = (problems[host] || []).filter((p) => Date.now() - p.at < 5 * 60 * 1000);
      sendResponse({
        show: true,
        reason: msg.reason,
        host,
        alternatives: alts,
        recentCount: recent.length
      });
      return;
    }
    sendResponse({ ok: false });
  })();
  return true; // async response
});

// Seed default state on first install.
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(["allowlist", "enabled"]);
  if (!cur.allowlist) await chrome.storage.local.set({ allowlist: [], enabled: true, problems: {} });
});
