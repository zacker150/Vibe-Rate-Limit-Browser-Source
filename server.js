const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { execFileSync, spawn } = require("node:child_process");

const PORT = Number(process.env.BROWSER_SOURCE_PORT || process.env.PORT || 3030);
const HOST = process.env.BROWSER_SOURCE_HOST || "127.0.0.1";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
const CLAUDE_CONFIG = process.env.CLAUDE_CONFIG || path.join(os.homedir(), ".claude.json");
const MANUAL_STATUS = process.env.MANUAL_STATUS || path.join(process.cwd(), "status.override.json");
const THEME_CONFIG = process.env.THEME_CONFIG || path.join(process.cwd(), "theme.config.json");
const CLAUDE_STATUSLINE_STATUS =
  process.env.CLAUDE_STATUSLINE_STATUS || path.join(process.cwd(), "claude-statusline-status.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const CLAUDE_AUTH_CACHE_MS = Number(process.env.CLAUDE_AUTH_CACHE_MS || 30000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

let claudeAuthCache = {
  checkedAt: 0,
  data: null,
  error: null
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listFiles(root, predicate) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (!predicate || predicate(full, entry)) {
        try {
          const stat = fs.statSync(full);
          out.push({ file: full, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          // File may be rotating while we scan it.
        }
      }
    }
  }
  return out;
}

function readTail(file, maxBytes = 1024 * 1024) {
  const stat = fs.statSync(file);
  const length = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function latestCodexLimits() {
  const sessionsRoot = path.join(CODEX_HOME, "sessions");
  const files = listFiles(sessionsRoot, (file) => file.endsWith(".jsonl"))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 20);

  let latest = null;
  for (const item of files) {
    let text = "";
    try {
      text = readTail(item.file);
    } catch {
      continue;
    }

    for (const line of text.trim().split(/\r?\n/).reverse()) {
      if (!line.includes('"rate_limits"')) continue;
      const event = safeJsonLine(line);
      const limits = event?.payload?.rate_limits;
      if (!limits) continue;

      latest = {
        provider: "codex",
        label: "Codex",
        status: limits.rate_limit_reached_type ? "limited" : "ok",
        planType: limits.plan_type || null,
        limitId: limits.limit_id || null,
        limitName: limits.limit_name || null,
        primary: normalizeWindow(limits.primary),
        secondary: normalizeWindow(limits.secondary),
        credits: limits.credits ?? null,
        reachedType: limits.rate_limit_reached_type || null,
        updatedAt: event.timestamp || new Date(item.mtimeMs).toISOString(),
        source: "codex-session"
      };
      break;
    }
    if (latest) break;
  }

  return latest || {
    provider: "codex",
    label: "Codex",
    status: "unknown",
    message: "No Codex rate-limit event found yet.",
    updatedAt: null,
    source: "codex-session"
  };
}

function safeJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeWindow(window) {
  if (!window) return null;
  return {
    usedPercent: Number(window.used_percent ?? 0),
    windowMinutes: Number(window.window_minutes ?? 0),
    resetsAt: typeof window.resets_at === "number" ? window.resets_at * 1000 : null
  };
}

function latestClaudeStatus() {
  const cli = claudeAuthStatus();
  const statusLine = claudeStatusLineLimits();
  const account = readJson(CLAUDE_CONFIG)?.oauthAccount || {};
  const credentials = readJson(path.join(CLAUDE_HOME, ".credentials.json")) || {};
  const oauth = credentials.claudeAiOauth || {};

  const status = {
    provider: "claude",
    label: "Claude Code",
    status: statusLine ? "ok" : cli?.loggedIn ? "ok" : "unknown",
    loggedIn: cli?.loggedIn ?? null,
    authMethod: cli?.authMethod || null,
    apiProvider: cli?.apiProvider || null,
    subscriptionType: cli?.subscriptionType || oauth.subscriptionType || null,
    rateLimitTier: oauth.rateLimitTier || null,
    orgName: sanitizeMessage(cli?.orgName || account.organizationName || ""),
    billingType: account.billingType || null,
    message: statusLine ? "Claude statusline rate limits" : "No Claude Code rate-limit event found yet.",
    primary: statusLine?.primary || null,
    secondary: statusLine?.secondary || null,
    limitEvent: null,
    cliError: cli ? null : claudeAuthCache.error,
    updatedAt: statusLine?.updatedAt || (cli ? new Date(claudeAuthCache.checkedAt).toISOString() : null),
    source: statusLine ? "claude-statusline" : "claude-cli"
  };

  if (statusLine) return status;

  const files = listFiles(path.join(CLAUDE_HOME, "projects"), (file) => file.endsWith(".jsonl"))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 20);

  for (const item of files) {
    let text = "";
    try {
      text = readTail(item.file);
    } catch {
      continue;
    }

    for (const line of text.trim().split(/\r?\n/).reverse()) {
      if (!/rate.?limit|usage.?limit|quota|too many requests|429|reset/i.test(line)) continue;
      const event = safeJsonLine(line);
      const textBits = collectText(event).join(" ");
      if (!/rate.?limit|usage.?limit|quota|too many requests|429|reset/i.test(textBits + line)) continue;

      const reset = findResetTime(textBits + " " + line);
      return {
        ...status,
        status: /429|rate.?limit|usage.?limit|too many requests/i.test(textBits + line) ? "limited" : "unknown",
        message: sanitizeMessage(textBits || "Claude Code logged a possible limit event."),
        limitEvent: {
          resetAt: reset,
          cwd: event?.cwd || null,
          version: event?.version || null
        },
        updatedAt: event?.timestamp || new Date(item.mtimeMs).toISOString(),
        source: "claude-cli-and-project-logs"
      };
    }
  }

  return status;
}

function claudeAuthStatus() {
  const now = Date.now();
  if (now - claudeAuthCache.checkedAt < CLAUDE_AUTH_CACHE_MS) {
    return claudeAuthCache.data;
  }

  try {
    const stdout = execFileSync(CLAUDE_BIN, ["auth", "status", "--json"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    claudeAuthCache = {
      checkedAt: now,
      data: JSON.parse(stdout),
      error: null
    };
  } catch (error) {
    claudeAuthCache = {
      checkedAt: now,
      data: null,
      error: sanitizeMessage(error.stderr?.toString() || error.message || "Claude CLI unavailable")
    };
  }

  return claudeAuthCache.data;
}

function claudeStatusLineLimits() {
  const snapshot = readJson(CLAUDE_STATUSLINE_STATUS);
  if (!snapshot?.rate_limits) return null;

  const fiveHour = snapshot.rate_limits.five_hour;
  const sevenDay = snapshot.rate_limits.seven_day;
  if (!fiveHour && !sevenDay) return null;

  return {
    primary: fiveHour ? normalizeStatusLineWindow(fiveHour, 300) : null,
    secondary: sevenDay ? normalizeStatusLineWindow(sevenDay, 10080) : null,
    updatedAt: snapshot.updatedAt || null,
    sessionId: snapshot.session_id || null,
    model: snapshot.model || null
  };
}

function normalizeStatusLineWindow(window, fallbackMinutes) {
  return {
    usedPercent: Number(window.used_percentage ?? window.usedPercent ?? 0),
    windowMinutes: Number(window.window_minutes ?? window.windowMinutes ?? fallbackMinutes),
    resetsAt:
      typeof window.resets_at === "number"
        ? window.resets_at * 1000
        : window.resetsAt
          ? Date.parse(window.resetsAt) || Number(window.resetsAt)
          : null
  };
}

function collectText(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
  } else if (typeof value === "object") {
    for (const key of ["text", "message", "error", "content"]) {
      collectText(value[key], out);
    }
  }
  return out;
}

function sanitizeMessage(message) {
  return String(message)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 180);
}

function findResetTime(text) {
  const unix = text.match(/\b1[67]\d{8,11}\b/);
  if (unix) {
    const raw = Number(unix[0]);
    return raw > 100000000000 ? raw : raw * 1000;
  }

  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  if (iso) {
    const ms = Date.parse(iso[0]);
    return Number.isNaN(ms) ? null : ms;
  }

  return null;
}

function buildStatus() {
  const manual = readJson(MANUAL_STATUS) || {};
  return {
    generatedAt: new Date().toISOString(),
    theme: themeConfig(),
    codex: mergeManual(latestCodexLimits(), manual.codex),
    claude: mergeManual(latestClaudeStatus(), manual.claude)
  };
}

function themeConfig() {
  const config = readJson(THEME_CONFIG);
  if (!config || typeof config !== "object") return null;

  const variables = {};
  for (const [key, value] of Object.entries(config.variables || {})) {
    if (!/^--[a-z0-9-]+$/i.test(key)) continue;
    if (typeof value !== "string") continue;
    if (/[;{}]/.test(value) || value.length > 120) continue;
    variables[key] = value;
  }

  return {
    name: typeof config.name === "string" ? config.name.slice(0, 60) : "custom",
    variables
  };
}

function mergeManual(base, override) {
  if (!override || typeof override !== "object") return base;
  return {
    ...base,
    ...override,
    primary: override.primary ? normalizeManualWindow(override.primary) : base.primary,
    secondary: override.secondary ? normalizeManualWindow(override.secondary) : base.secondary,
    source: override.source || "manual-override"
  };
}

function normalizeManualWindow(window) {
  return {
    usedPercent: Number(window.usedPercent ?? window.used_percent ?? 0),
    windowMinutes: Number(window.windowMinutes ?? window.window_minutes ?? 0),
    resetsAt: window.resetsAt ? Date.parse(window.resetsAt) || Number(window.resetsAt) : null
  };
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/status") {
    const status = buildStatus();
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    });
    res.end(JSON.stringify(status));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Browser source rate-limit server: http://${HOST}:${PORT}`);
  spawn(CODEX_BIN, ["exec", "Hello"], { stdio: "ignore", windowsHide: true }).unref();
  spawn(CLAUDE_BIN, ["-p", "Hello"], { stdio: "ignore", windowsHide: true }).unref();
});
