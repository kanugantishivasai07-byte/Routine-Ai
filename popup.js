const $ = (id) => document.getElementById(id);

function normalizeHost(input) {
  let v = input.trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return v.split("/")[0];
}

async function getState() {
  const { allowlist = [], enabled = true } = await chrome.storage.local.get(["allowlist", "enabled"]);
  return { allowlist, enabled };
}

async function render() {
  const { allowlist, enabled } = await getState();
  $("enabled").checked = enabled;
  $("count").textContent = `${allowlist.length} site${allowlist.length === 1 ? "" : "s"}`;
  const list = $("list");
  list.innerHTML = "";
  for (const host of allowlist) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${host}</span>`;
    const btn = document.createElement("button");
    btn.className = "del";
    btn.textContent = "✕";
    btn.onclick = async () => {
      const s = await getState();
      await chrome.storage.local.set({ allowlist: s.allowlist.filter((h) => h !== host) });
      render();
    };
    li.appendChild(btn);
    list.appendChild(li);
  }
}

$("add").onclick = async () => {
  const host = normalizeHost($("site").value);
  if (!host) return;
  const s = await getState();
  if (!s.allowlist.includes(host)) s.allowlist.push(host);
  await chrome.storage.local.set({ allowlist: s.allowlist });
  $("site").value = "";
  render();
};

$("site").addEventListener("keydown", (e) => { if (e.key === "Enter") $("add").click(); });

$("enabled").onchange = async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
};

$("clear").onclick = async () => {
  await chrome.storage.local.set({ allowlist: [] });
  render();
};

$("importHistory").onclick = async () => {
  // Reads recent history WITH user gesture, extracts unique hosts, adds top ones.
  const since = Date.now() - 1000 * 60 * 60 * 24 * 14; // last 14 days
  const items = await chrome.history.search({ text: "", startTime: since, maxResults: 500 });
  const freq = new Map();
  for (const it of items) {
    try {
      const host = new URL(it.url).hostname.replace(/^www\./, "");
      freq.set(host, (freq.get(host) || 0) + 1);
    } catch (_) { /* ignore non-URL history entries */ }
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map((e) => e[0]);
  const s = await getState();
  for (const h of top) if (!s.allowlist.includes(h)) s.allowlist.push(h);
  await chrome.storage.local.set({ allowlist: s.allowlist });
  render();
};

render();
