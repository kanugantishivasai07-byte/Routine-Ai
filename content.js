// Content script: instruments the page to detect frustration signals and glitches.
// Only runs if the background confirms this host is in the user's allow-list.

(async function init() {
  const resp = await chrome.runtime.sendMessage({ type: "CAN_MONITOR", url: location.href });
  if (!resp || !resp.allowed) return;

  const state = {
    frustration: 0,          // 0..100 rolling score
    lastScrollSamples: [],   // {t, dy}
    lastClicks: [],          // timestamps of clicks
    lastSwipes: [],          // {t, vx, dir}
    longTasks: 0,
    jsErrors: 0,
    loadMs: null,
    lastNudge: 0
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const now = () => performance.now();

  function bump(amount, reason) {
    state.frustration = clamp(state.frustration + amount, 0, 100);
    // frustration naturally decays
    if (state.frustration >= 70) maybeNudge(reason);
  }

  // decay over time
  setInterval(() => { state.frustration = clamp(state.frustration - 1.5, 0, 100); }, 1000);

  // ---------- Scroll speed / erratic scrolling ----------
  let lastScrollY = window.scrollY, lastScrollT = now();
  function onScroll() {
    const t = now();
    const dy = Math.abs(window.scrollY - lastScrollY);
    const dt = Math.max(1, t - lastScrollT);
    const velocity = dy / dt * 1000; // px per second
    lastScrollY = window.scrollY; lastScrollT = t;

    state.lastScrollSamples.push({ t, dy, dir: Math.sign(window.scrollY - lastScrollY || 1) });
    if (state.lastScrollSamples.length > 12) state.lastScrollSamples.shift();

    // Very fast flinging
    if (velocity > 6000) bump(6, "fast-scrolling");

    // Erratic: many direction reversals in a short window (searching desperately)
    const recent = state.lastScrollSamples.filter((s) => t - s.t < 1500);
    let reversals = 0;
    for (let i = 1; i < recent.length; i++) if (recent[i].dir !== recent[i - 1].dir && recent[i].dir !== 0) reversals++;
    if (reversals >= 5) bump(5, "erratic-scrolling");
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---------- Rage taps / clicks ----------
  function onClick(e) {
    const t = now();
    state.lastClicks.push(t);
    state.lastClicks = state.lastClicks.filter((x) => t - x < 1500);

    // 4+ clicks within 1.5s = rage clicking
    if (state.lastClicks.length >= 4) bump(12, "rage-tapping");

    // pointer pressure (real "harsh tap" where the device supports it)
    if (e.pointerType === "touch" && e.pressure && e.pressure > 0.6) bump(8, "harsh-tap");
  }
  window.addEventListener("click", onClick, true);
  window.addEventListener("pointerdown", onClick, true);

  // ---------- Harsh / fast swipes ----------
  let touchStart = null;
  function onTouchStart(e) {
    const t0 = now();
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: t0, lastX: e.touches[0].clientX, dirX: 0, flips: 0 };
  }
  function onTouchMove(e) {
    if (!touchStart) return;
    const x = e.touches[0].clientX;
    const dir = Math.sign(x - touchStart.lastX);
    if (dir !== 0 && touchStart.dirX !== 0 && dir !== touchStart.dirX) touchStart.flips++;
    if (dir !== 0) touchStart.dirX = dir;
    touchStart.lastX = x;
  }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const t = now();
    const dt = Math.max(1, t - touchStart.t);
    const ch = e.changedTouches[0];
    const dist = Math.hypot(ch.clientX - touchStart.x, ch.clientY - touchStart.y);
    const velocity = dist / dt * 1000; // px/s
    state.lastSwipes.push({ t, vx: velocity });
    if (state.lastSwipes.length > 6) state.lastSwipes.shift();

    if (velocity > 3500) bump(6, "harsh-swiping");          // very fast swipe
    if (touchStart.flips >= 3) bump(7, "erratic-swiping");  // back-and-forth swiping
    touchStart = null;
  }
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });

  // ---------- Glitch / overload detection ----------
  // Page load time
  window.addEventListener("load", () => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav) {
      state.loadMs = nav.loadEventEnd - nav.startTime;
      if (state.loadMs > 5000) bump(15, "slow-page-load");
    }
  });

  // Long tasks = main thread blocked / laggy page
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks++;
        if (entry.duration > 200) bump(8, "page-frozen");
      }
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch (_) { /* longtask not supported in all browsers */ }

  // JS errors = broken/glitchy page
  window.addEventListener("error", () => { state.jsErrors++; bump(10, "page-error"); });
  window.addEventListener("unhandledrejection", () => { bump(6, "page-error"); });

  // Failed network requests (via Resource Timing) -> overload / broken assets
  try {
    const ro = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.responseStatus && e.responseStatus >= 500) bump(10, "server-error");
      }
    });
    ro.observe({ type: "resource", buffered: true });
  } catch (_) { /* responseStatus not supported everywhere */ }

  // ---------- Nudge the user with suggestions ----------
  async function maybeNudge(reason) {
    const t = Date.now();
    if (t - state.lastNudge < 20000) return; // don't spam: max once per 20s
    state.lastNudge = t;

    const res = await chrome.runtime.sendMessage({
      type: "FRUSTRATION_EVENT",
      url: location.href,
      reason
    });
    if (res && res.show) showOverlay(res, reason);
    // reset so the user has to get frustrated again before the next nudge
    state.frustration = 40;
  }

  function showOverlay(res, reason) {
    let box = document.getElementById("frus-assistant-box");
    if (box) box.remove();

    box = document.createElement("div");
    box.id = "frus-assistant-box";

    const humanReason = {
      "rage-tapping": "repeated aggressive tapping",
      "harsh-tap": "hard presses detected",
      "fast-scrolling": "very fast scrolling",
      "erratic-scrolling": "frantic up/down scrolling",
      "harsh-swiping": "fast forceful swipes",
      "erratic-swiping": "repeated back-and-forth swipes",
      "slow-page-load": "this page took a long time to load",
      "page-frozen": "this page froze / lagged",
      "page-error": "this page threw errors",
      "server-error": "this site returned a server error"
    }[reason] || "signs of frustration";

    const alts = (res.alternatives || [])
      .map((a) => `<a href="https://${a}" target="_blank" rel="noopener">${a}</a>`)
      .join("") || "No mapped alternatives yet — try a different site for the same content.";

    box.innerHTML = `
      <div class="frus-head">
        <span>😖 This page seems to be bothering you</span>
        <button id="frus-close" aria-label="Close">×</button>
      </div>
      <div class="frus-body">
        <p>We noticed <b>${humanReason}</b>${res.recentCount > 2 ? ` (happened ${res.recentCount}× recently on ${res.host})` : ""}.</p>
        <p class="frus-label">Try these for similar content:</p>
        <div class="frus-alts">${alts}</div>
        <button id="frus-dismiss" class="frus-muted">I'm fine, keep going</button>
      </div>`;

    document.documentElement.appendChild(box);
    box.querySelector("#frus-close").onclick = () => box.remove();
    box.querySelector("#frus-dismiss").onclick = () => box.remove();
  }

  // Inject the overlay stylesheet.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("overlay.css");
  (document.head || document.documentElement).appendChild(link);
})();
