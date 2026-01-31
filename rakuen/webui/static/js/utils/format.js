// Agent info, timestamp formatting, and minimal Markdown parser

/** Agent metadata map */
export const AGENT_INFO = {
  user:    { label: "User",    color: "#4caf50", type: "user" },
  uichan:  { label: "UI-chan",  color: "#d4a017", type: "uichan" },
  aichan:  { label: "AI-chan",  color: "#dc143c", type: "aichan" },
  kobito1: { label: "Kobito 1", color: "#4682b4", type: "kobito" },
  kobito2: { label: "Kobito 2", color: "#4682b4", type: "kobito" },
  kobito3: { label: "Kobito 3", color: "#4682b4", type: "kobito" },
  kobito4: { label: "Kobito 4", color: "#4682b4", type: "kobito" },
  kobito5: { label: "Kobito 5", color: "#4682b4", type: "kobito" },
  kobito6: { label: "Kobito 6", color: "#4682b4", type: "kobito" },
  kobito7: { label: "Kobito 7", color: "#4682b4", type: "kobito" },
  kobito8: { label: "Kobito 8", color: "#4682b4", type: "kobito" },
};

/**
 * Returns the color hex string for the given agent name.
 * @param {string} name
 * @returns {string}
 */
export function agentColor(name) {
  return AGENT_INFO[name]?.color ?? "#999";
}

/**
 * Returns the display label for the given agent name.
 * @param {string} name
 * @returns {string}
 */
export function agentLabel(name) {
  return AGENT_INFO[name]?.label ?? name;
}

/**
 * Formats an ISO timestamp string to "HH:MM:SS".
 * @param {string} isoString
 * @returns {string}
 */
export function formatTimestamp(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Returns a Japanese label for the entry type.
 * @param {string} type - "command" | "assignment" | "report"
 * @returns {string}
 */
export function entryTypeLabel(type) {
  switch (type) {
    case "user_input": return "入力";
    case "command":    return "指示";
    case "progress":   return "作業";
    case "assignment": return "割当";
    case "report":     return "報告";
    case "attention":  return "要対応";
    default:           return type || "---";
  }
}

/**
 * Returns a Japanese label for the entry status.
 * @param {string} status
 * @returns {string}
 */
export function statusLabel(status) {
  switch (status) {
    case "done":        return "完了";
    case "pending":     return "待機";
    case "in_progress": return "実行中";
    case "working":     return "作業中";
    case "cancelled":   return "中止";
    default:            return "";
  }
}

/**
 * Minimal Markdown to HTML renderer.
 * Supports headings (#, ##, ###), unordered lists (- / *),
 * bold (**text**), inline code (`text`), and paragraphs.
 * @param {string} text
 * @returns {string} HTML string
 */
export function renderMarkdown(text) {
  if (!text) return "";

  const lines = text.split("\n");
  const out = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Empty line: close list if open, skip
    if (line.trim() === "") {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }

    // Headings (check ### before ## before #)
    if (line.startsWith("### ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
      continue;
    }

    // List items
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }

    // Paragraph (close list if open)
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inList) {
    out.push("</ul>");
  }

  return out.join("\n");
}

/**
 * Applies inline formatting: bold and code.
 * @param {string} text
 * @returns {string}
 */
function inlineFormat(text) {
  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Inline code: `text`
  text = text.replace(/`(.+?)`/g, "<code>$1</code>");
  return text;
}
