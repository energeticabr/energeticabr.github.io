import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const frameWidths = new Map();

// Windows browser frame widths vary with Chrome/DPI. Calibrate innerWidth;
// callers still assert the exact viewport and every content-overflow limit.
export async function runBrowserLayout(browser, { width, height, url, maxBuffer = 2_000_000 }) {
  let frameWidth = frameWidths.get(browser) ?? (process.platform === "win32" ? 26 : 0);
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await run(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-dev-shm-usage",
      `--window-size=${width + frameWidth},${height}`, "--virtual-time-budget=3000", "--dump-dom", url,
    ], { timeout: 30_000, maxBuffer });
    const match = /data-layout="([^"]+)"/.exec(result.stdout);
    if (!match) return result;
    const measured = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&")).viewport;
    if (measured === width) {
      frameWidths.set(browser, frameWidth);
      return result;
    }
    if (!Number.isFinite(measured) || Math.abs(measured - width) > 64) return result;
    frameWidth += width - measured;
  }
  return result;
}
