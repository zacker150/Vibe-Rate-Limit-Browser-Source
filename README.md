# Browser Source AI Rate Limits

Local browser source for Claude Code and Codex rate-limit status.

## Run

```powershell
npm start
```

Add this URL as a browser source:

```text
http://127.0.0.1:3030
```

Suggested browser source size: `760x260`.

## What It Tracks

- Codex: reads the newest local Codex session JSONL files and displays the live `rate_limits` payload when Codex writes one.
- Claude Code: reads `claude-statusline-status.json`, written by the Claude Code statusline hook. That snapshot can include official 5-hour and 7-day `rate_limits` percentages and reset timestamps. The server also runs `claude auth status --json` on a short cache to show CLI login, auth, provider, and subscription status, then falls back to local Claude project JSONL logs for usage-limit, rate-limit, quota, 429, or reset messages.

The server only exposes a sanitized status JSON at `/api/status`. It does not return tokens, emails, prompts, or session content.

## Claude Rate Limits

Claude Code exposes current subscription rate-limit windows to custom statusline scripts after the first API response in a Claude.ai Pro/Max session. The capture script writes:

```text
claude-statusline-status.json
```

To refresh Claude rate limits:

1. Start the browser source server with `npm start`.
2. Open Claude Code normally, not `claude -p`.
3. Send one message so Claude Code receives an API response.
4. Keep that Claude Code session open if you want the snapshot to keep refreshing.

Add this to your Claude Code `settings.json`, replacing `<repo-path>` with this repository's absolute path:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<repo-path>\\scripts\\claude-statusline-capture.js\""
  }
}
```

On Windows, the Claude Code user settings file is usually under `%USERPROFILE%\.claude\settings.json`. If the settings file already has `statusLine`, replace just that object.

The `rate_limits` field can be absent before the first API response, for non-Claude.ai subscription auth, or if Claude Code does not receive rate-limit data for that session. In that case, the overlay shows CLI/auth status and any detected limit event instead of percentages.

## Manual Override

Copy `status.override.example.json` to `status.override.json` to manually provide a Claude or Codex window when a tool has not written a local limit event yet.

```json
{
  "claude": {
    "status": "ok",
    "primary": {
      "usedPercent": 42,
      "windowMinutes": 300,
      "resetsAt": "2026-05-03T04:00:00Z"
    }
  }
}
```

## Theme Config

Edit `theme.config.json` to change colors and compact layout values without touching CSS. The server reads it on every `/api/status` request, so refresh the browser source or wait for the next 5-second browser refresh after saving.

Example:

```json
{
  "name": "default-compact",
  "variables": {
    "--panel": "rgba(10, 14, 20, 0.68)",
    "--text": "#f7f8fb",
    "--muted": "#a8b0bd",
    "--ok": "#34d399",
    "--warn": "#f59e0b",
    "--bad": "#fb7185",
    "--codex": "#60a5fa",
    "--claude": "#f97316",
    "--overlay-width": "520px",
    "--provider-min-height": "86px",
    "--bar-height": "5px"
  }
}
```

Supported variables are regular CSS custom properties used by `public/styles.css`. Useful ones:

- Colors: `--bg`, `--panel`, `--line`, `--text`, `--muted`, `--ok`, `--warn`, `--bad`, `--codex`, `--claude`, `--track`
- Layout: `--overlay-width`, `--overlay-padding`, `--provider-gap`, `--provider-min-height`, `--provider-padding`, `--radius`, `--bar-height`
- Type: `--title-size`, `--meta-size`, `--label-size`, `--badge-size`
- Effects: `--shadow`

## Settings

Environment variables:

- `BROWSER_SOURCE_PORT`: server port, default `3030`
- `BROWSER_SOURCE_HOST`: server host, default `127.0.0.1`
- `CLAUDE_BIN`: Claude CLI command or full path, default `claude`
- `CLAUDE_AUTH_CACHE_MS`: Claude CLI auth-status cache duration, default `30000`
- `CLAUDE_STATUSLINE_STATUS`: Claude statusline snapshot path, default `claude-statusline-status.json`
- `THEME_CONFIG`: theme JSON path, default `theme.config.json`
- `CODEX_HOME`: Codex data directory, default to the current user's `.codex` directory
- `CLAUDE_HOME`: Claude Code data directory, default to the current user's `.claude` directory
- `CLAUDE_CONFIG`: Claude config file, default to the current user's `.claude.json` file
- `MANUAL_STATUS`: override JSON path, default `status.override.json`
