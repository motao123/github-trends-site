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

/**
 * 图标系统 —— 严格遵循 Lucide 规范：
 *
 *   1. 统一 24 × 24 画布（正方形）
 *   2. 统一 2px 描边宽度
 *   3. 开放路径用 round linecap，拐角用 round linejoin
 *   4. 颜色一律 currentColor，由 CSS 控制，主题切换自动跟随
 *   5. 元素间至少留 2px 视觉间隙
 *
 * 这套约束消除了原先"7 种 viewBox + 11 种描边宽度"造成的风格混杂。
 * 路径数据取自 Lucide 官方图标（ISC 协议），并按本项目需要做了简化。
 */
const ICON_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  // 搜索：圆心 11 / 半径 7，手柄到 20
  search: `<svg ${ICON_ATTRS}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,

  // 太阳：圆心 12 / 半径 4，八向光芒
  sun: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,

  // 月亮：标准月牙路径
  moon: `<svg ${ICON_ATTRS}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,

  // 星标（空心 / 实心共用同一路径）
  star: `<svg ${ICON_ATTRS}><path d="M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9L12 2.5z"/></svg>`,
  starFill: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9L12 2.5z"/></svg>`,

  // 刷新：逆时针弧 + 箭头
  refresh: `<svg ${ICON_ATTRS}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,

  // 下载：竖线 + 下箭头 + 底座
  download: `<svg ${ICON_ATTRS}><path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19h16"/></svg>`,

  // 趋势：折线 + 端点
  trend: `<svg ${ICON_ATTRS}><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,

  // 错误：圆 + 感叹号
  error: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>`,

  // 警告：三角 + 感叹号
  warn: `<svg ${ICON_ATTRS}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5"/><path d="M12 17.5h.01"/></svg>`,

  // 空态：简化的文件/列表轮廓
  empty: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7.5 13.5h6M7.5 16.5h4"/></svg>`,

  // 外部链接：方框 + 箭头
  external: `<svg ${ICON_ATTRS}><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,

  // 复选对比
  compare: `<svg ${ICON_ATTRS}><path d="M4 6h7M4 12h7M4 18h7"/><path d="M17 4v16M20 4v16"/></svg>`,

  // 关闭 / 移除
  x: `<svg ${ICON_ATTRS}><path d="M18 6L6 18M6 6l12 12"/></svg>`,

  // 排序：箭头向上 / 向下 / 双向
  sortAsc: `<svg ${ICON_ATTRS}><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`,
  sortDesc: `<svg ${ICON_ATTRS}><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>`,
  sortBoth: `<svg ${ICON_ATTRS}><path d="M8 9l4-4 4 4"/><path d="M16 15l-4 4-4-4"/></svg>`,

  // 翻页
  chevronLeft: `<svg ${ICON_ATTRS}><path d="M15 18l-6-6 6-6"/></svg>`,
  chevronRight: `<svg ${ICON_ATTRS}><path d="M9 18l6-6-6-6"/></svg>`,

  // 更多
  more: `<svg ${ICON_ATTRS}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>`,

  // 分隔符（面包屑）
  separator: `<svg ${ICON_ATTRS}><path d="M9 18l6-6-6-6"/></svg>`,

  // 仓库（GitHub 官方仓库轮廓，用于替代项目头像）
  repo: `<svg ${ICON_ATTRS}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
};

/**
 * 生成图标节点。
 * @param {string} name  ICONS 中的键
 * @param {number} size  渲染尺寸（px）。实际描边宽度随尺寸缩放，
 *                       视觉上保持与文字基线的比例关系。
 */
export function icon(name, size = 16) {
  const span = el("span", { class: "icon", "aria-hidden": "true" });
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
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
