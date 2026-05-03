const fs = require("node:fs");
const path = require("node:path");

const outputPath =
  process.env.CLAUDE_STATUSLINE_STATUS ||
  path.join(__dirname, "..", "claude-statusline-status.json");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input || "{}");
    const snapshot = {
      updatedAt: new Date().toISOString(),
      session_id: payload.session_id || null,
      transcript_path: payload.transcript_path || null,
      version: payload.version || null,
      model: payload.model?.display_name || payload.model?.id || null,
      rate_limits: payload.rate_limits || null
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));

    const five = payload.rate_limits?.five_hour?.used_percentage;
    const week = payload.rate_limits?.seven_day?.used_percentage;
    const bits = [];
    if (typeof five === "number") bits.push(`5h ${five.toFixed(0)}%`);
    if (typeof week === "number") bits.push(`7d ${week.toFixed(0)}%`);
    process.stdout.write(bits.length ? `Claude ${bits.join(" ")}` : "Claude");
  } catch {
    process.stdout.write("Claude");
  }
});
