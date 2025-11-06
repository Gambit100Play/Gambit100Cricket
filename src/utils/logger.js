// src/utils/logger.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DateTime } from "luxon";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../../logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "cricpredict.log");

// 🧼 Regex to remove ANSI color codes (for file output)
const ANSI_REGEX = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])",
  "g"
);

/**
 * Append a line to log file with timestamp (clean output, no colors)
 */
export function logToFile(message, type = "INFO") {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm:ss a");
  const cleanMsg = String(message).replace(ANSI_REGEX, ""); // strip terminal color codes
  const line = `[${now}] [${type}] ${cleanMsg}\n`;
  fs.appendFileSync(LOG_FILE, line, { encoding: "utf8" });
}

/**
 * Centralized logger: mirrors logs to console + file
 */
export const logger = {
  info: (msg) => {
    const formatted = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
    console.log(formatted); // keep console color
    logToFile(formatted, "INFO");
  },
  warn: (msg) => {
    const formatted = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
    console.warn(formatted);
    logToFile(formatted, "WARN");
  },
  error: (msg) => {
    console.error(msg);
    const formatted = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
    logToFile(formatted, "ERROR");
  },
  debug: (msg) => {
    const formatted = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
    if (process.env.NODE_ENV !== "production") {
      console.debug(formatted);
    }
    logToFile(formatted, "DEBUG");
  },
};
