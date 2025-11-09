// =====================================================
// 🧹 Telegram MarkdownV2 Safe Escaper (v2.0 Final)
// =====================================================
export function safeMarkdown(text = "") {
  if (!text) return "";

  // Escape only the MarkdownV2 special characters, EXCEPT underscores inside normal words.
  // Example: "LOCKED_PRE" stays as "LOCKED_PRE", not "LOCKED\\_PRE"
  return String(text)
    .replace(/([*[\]()~`>#+\-=|{}.!\\])/g, "\\$1") // core Markdown escapes
    .replace(/(^|[^a-zA-Z0-9])_([^a-zA-Z0-9]|$)/g, "\\_$2"); // only escape stray underscores
}
