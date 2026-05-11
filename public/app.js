const cards = {
  codex: document.querySelector("#codex-card"),
  claude: document.querySelector("#claude-card")
};

function statusText(status) {
  if (status === "ok") return "OK";
  if (status === "limited") return "Limited";
  return "Unknown";
}

function renderProvider(key, data) {
  const card = cards[key];
  card.classList.remove("ok", "limited", "unknown");
  card.classList.add(data.status || "unknown");
  card.querySelector('[data-field="status"]').textContent = statusText(data.status);
  card.querySelector('[data-field="meta"]').textContent = metaText(data);

  const windows = card.querySelector(".windows");
  windows.innerHTML = "";

  const rows = [];
  if (data.primary) rows.push(["5h", data.primary]);
  if (data.secondary) rows.push(["Weekly", data.secondary]);
  if (data.limitEvent?.resetAt) {
    rows.push(["Reset", { usedPercent: data.status === "limited" ? 100 : 0, resetsAt: data.limitEvent.resetAt }]);
  }

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = data.message || "No live limit window available.";
    windows.append(empty);
    return;
  }

  for (const [label, window] of rows) {
    windows.append(renderWindow(label, window));
  }
}

function metaText(data) {
  const bits = [];
  if (data.reachedType) bits.push(data.reachedType.replaceAll("_", " "));
  if (data.cliError) bits.push(data.cliError);
  if (data.message && data.status !== "ok") bits.push(data.message);
  return bits.join(" / ");
}

function renderWindow(label, window) {
  const used = Math.max(0, Math.min(100, Number(window.usedPercent || 0)));
  const item = document.createElement("div");
  item.className = "window";

  const row = document.createElement("div");
  row.className = "window-row";

  const name = document.createElement("span");
  name.textContent = label;

  const value = document.createElement("span");
  value.className = "value";
  value.textContent = `${used.toFixed(0)}% used`;

  const bar = document.createElement("div");
  bar.className = "bar";

  const fill = document.createElement("div");
  fill.className = `fill ${used >= 85 ? "bad" : used >= 65 ? "warn" : ""}`;
  fill.style.width = `${used}%`;

  row.append(name, value);
  bar.append(fill);
  item.append(row, bar);
  return item;
}


async function refresh() {
  try {
    const response = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    applyTheme(data.theme);
    renderProvider("codex", data.codex);
    renderProvider("claude", data.claude);
  } catch (error) {
    for (const card of Object.values(cards)) {
      card.querySelector('[data-field="status"]').textContent = "Offline";
      card.querySelector('[data-field="meta"]').textContent = "Source offline";
    }
  }
}

function applyTheme(theme) {
  if (!theme?.variables) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(key, value);
  }
}

refresh();
setInterval(refresh, 5000);
