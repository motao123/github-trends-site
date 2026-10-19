/**
 * 轻量 DOM / 格式化工具。不引入框架，保持纯静态可部署。
 */

export const LANG_COLORS = {
  Python: "#3178C6",
  TypeScript: "#3178C6",
  JavaScript: "#F1E05A",
  Go: "#00ADD8",
  Rust: "#DEA584",
  Java: "#B07219",
  "C++": "#F34B7D",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Shell: "#89E051",
  HTML: "#E34C26",
  CSS: "#563D7C",
  Vue: "#41B883",
  Svelte: "#FF3E00",
  Dart: "#00B4AB",
  Lua: "#000080",
  "Jupyter Notebook": "#DA5B0B",
};

export function langColor(language) {
  return LANG_COLORS[language] || "#9CA3AF";
}

/** 千分位格式化。null 走短横线，避免把「无数据」显示成 0。 */
export function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US");
}

export function formatDelta(value, suffix = "") {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toLocaleString("en-US")}${suffix}`;
}

export function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

/** 相对时间：GitHub 风格的「2 小时前」。 */
export function relativeTime(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 0) return "刚刚";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 仓库名首字母，用作无图头像。 */
export function initials(fullName) {
  const cleaned = String(fullName || "?").replace(/[-_.]/g, " ");
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** 按 owner 名派生一个稳定的头像底色。 */
export function avatarColor(seed) {
  const palette = ["#5046E5", "#10B981", "#F59E0B", "#EF4444", "#0EA5E9", "#8B5CF6"];
  let hash = 0;
  const str = String(seed || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/**
 * 极简 hyperscript。
 * el("div", {class: "x"}, [child, "text"])
 * 也支持可变参数：el("a", {href}, iconNode, "文字")
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  const list = children.flat(Infinity);
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node, ...children) {
  clear(node);
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 轻量 toast 反馈。 */
let toastTimer = null;
export function toast(message) {
  let node = document.querySelector("#toast");
  if (!node) {
    node = el("div", { id: "toast", class: "toast", role: "status" });
    document.body.append(node);
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2600);
}

/** 内联 SVG 图标集。 */
const ICONS = {
  search: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.5"/><path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  sun: '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="3.6" stroke="currentColor" stroke-width="1.5"/><path d="M18 7.5v2.2M18 26.3v2.2M7.5 18h2.2M26.3 18h2.2M10.6 10.6l1.6 1.6M23.8 23.8l1.6 1.6M25.4 10.6l-1.6 1.6M12.2 23.8l-1.6 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  moon: '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M25 21.5A9.5 9.5 0 0 1 14.5 11a9.5 9.5 0 1 0 10.5 10.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.9l1.58 3.2 3.53.51-2.56 2.49.6 3.52L7 9.83l-3.15 1.66.6-3.52L1.9 5.6l3.52-.51L7 1.9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  starFill: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.9l1.58 3.2 3.53.51-2.56 2.49.6 3.52L7 9.83l-3.15 1.66.6-3.52L1.9 5.6l3.52-.51L7 1.9z" fill="currentColor"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.6 8a5.6 5.6 0 1 1-1.68-4.02" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.6 1.8V4.7H10.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.8v7.4M7 9.2L4.4 6.6M7 9.2l2.6-2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.6v1.1h9.6v-1.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  trend: '<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M6 20.5L11 14l3.6 3.4L22 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="8" r="2.4" fill="#fff"/></svg>',
  error: '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7.4" stroke="currentColor" stroke-width="1.8"/><path d="M9 5.2v4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="12.6" r="1" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 2.2L16.4 15H1.6L9 2.2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 6.8v3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="12.6" r="0.95" fill="currentColor"/></svg>',
  empty: '<svg viewBox="0 0 72 72" fill="none" aria-hidden="true"><rect x="8" y="16" width="56" height="42" rx="8" stroke="#D1D5DB" stroke-width="2"/><path d="M8 28h56" stroke="#D1D5DB" stroke-width="2"/><path d="M18 38h26M18 47h16" stroke="#E7E7EA" stroke-width="3" stroke-linecap="round"/></svg>',
};

export function icon(name, size = 16) {
  const span = el("span", { class: "icon", "aria-hidden": "true", style: `display:inline-flex;width:${size}px;height:${size}px` });
  span.innerHTML = ICONS[name] || "";
  return span;
}

/** CSV 导出（带 BOM，保证 Excel 正确识别 UTF-8）。 */
export function exportCsv(filename, rows) {
  const header = ["排名", "项目", "主要语言", "Star 总数", "周期增长", "Fork", "创建时间", "最近推送", "话题"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((row, index) =>
    [
      index + 1,
      row.fullName,
      row.language,
      row.stars,
      row.periodGrowth ?? "",
      row.forks,
      row.createdAt,
      row.pushedAt,
      (row.topics || []).join(" "),
    ]
      .map(escape)
      .join(",")
  );
  const csv = `\uFEFF${[header.map(escape).join(","), ...body].join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
