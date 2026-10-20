/**
 * 共享 UI 组件：顶栏、状态区、表格行、图表。
 */

import { el, mount, icon, langColor, formatNumber, relativeTime } from "../lib/ui.js";
import { getTheme, setTheme } from "../lib/store.js";
import { PERIODS, freshnessLabel, clockLabel } from "../lib/data.js";

/* ---------------- 顶栏 ---------------- */

/**
 * 顶栏的持久化节点。
 *
 * 背景：页面每次状态变化都会整体重绘（mount(app, ...)）。如果顶栏跟着
 * 一起重建，会出两个问题：
 *   1. 搜索框被换成新节点，用户输入的文字随旧节点一起被丢弃
 *      —— 表现为"打了字但框里看不见"
 *   2. 节点被移动出文档的瞬间会失焦，光标跳回开头
 *
 * 解决：整个顶栏只构建一次，之后只更新「当前导航项」这一个属性。
 * 这样输入框节点与它的父容器都不再移动，焦点与光标自然保持。
 */
let topbarNode = null;
let topbarNav = null;

/** 获取（必要时创建）持久化的搜索输入框节点。 */
function getSearchInput() {
  if (!topbarNode) buildTopbar();
  return topbarNode.querySelector("#global-search");
}

/** 把当前关键词同步进搜索框（用于 URL 参数初始化等场景）。 */
export function setSearchValue(value) {
  const input = getSearchInput();
  if (input && input.value !== value) input.value = value;
}

/** 构建顶栏（只执行一次）。 */
function buildTopbar() {
  const items = [
    { id: "leaderboard", label: "趋势榜单", href: "./index.html" },
    { id: "overview", label: "总览面板", href: "./overview.html" },
    { id: "favorites", label: "我的收藏", href: "./favorites.html" },
    { id: "compare", label: "项目对比", href: "./compare.html" },
  ];

  const searchInput = el("input", {
    type: "search",
    placeholder: "搜索项目 / 话题 / 作者",
    "aria-label": "搜索项目",
    id: "global-search",
    autocomplete: "off",
  });

  const themeBtn = el("button", {
    class: "icon-btn",
    type: "button",
    "aria-label": "切换深浅色主题",
    title: "切换主题",
  });
  const paintTheme = () => {
    mount(themeBtn, icon(getTheme() === "dark" ? "sun" : "moon", 16));
  };
  paintTheme();
  themeBtn.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    paintTheme();
  });

  const nav = el(
    "nav",
    { class: "nav", "aria-label": "主导航" },
    items.map((item) =>
      el("a", {
        class: "nav__item",
        href: item.href,
        text: item.label,
        dataset: { navId: item.id },
      }),
    ),
  );
  topbarNav = nav;

  topbarNode = el(
    "header",
    { class: "topbar" },
    el(
      "div",
      { class: "topbar__brand" },
      el(
        "a",
        { class: "brand", href: "./index.html" },
        [el("span", { class: "brand__mark", html: icon("trend", 15).innerHTML }), "开源趋势站"],
      ),
      nav,
    ),
    el(
      "div",
      { class: "topbar__actions" },
      el("div", { class: "search" }, icon("search", 16), searchInput),
      themeBtn,
    ),
  );

  return topbarNode;
}

/**
 * 返回顶栏节点。
 * 重绘时只更新当前导航项的高亮状态，其余部分（含搜索框）原样保留。
 */
export function renderTopbar(active = "leaderboard") {
  if (!topbarNode) buildTopbar();
  if (topbarNav) {
    for (const link of topbarNav.querySelectorAll(".nav__item")) {
      if (link.dataset.navId === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  return topbarNode;
}

/**
 * 顶栏搜索框与状态层联动，供各页面挂载。
 *
 * 因为输入框是持久化节点，这里的监听器只需绑定一次；
 * 即使重复调用，旧的 input 事件监听也不会导致重复触发
 * （同一个节点上只挂一次，用标记位守卫）。
 */
let searchBound = false;
export function bindTopbarSearch(onSearch) {
  const input = getSearchInput();
  if (!input || searchBound) return;
  searchBound = true;
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSearch(input.value.trim()), 220);
  });
}

/* ---------------- 状态区 ---------------- */

export function loadingState(label = "正在拉取最新榜单数据 · 骨架占位保持布局稳定") {
  return el(
    "div",
    { class: "state", role: "status", "aria-busy": "true" },
    el(
      "div",
      { class: "skeleton-row skeleton-row--inline" },
      el("div", { class: "skeleton" }),
      el("div", { class: "skeleton" }),
      el("div", { class: "skeleton" }),
    ),
    el("p", { class: "state__desc", text: label }),
  );
}

export function emptyState({ title = "当前筛选条件下没有匹配项目", desc = "试试切换时间周期，或移除部分筛选标签后重新筛选", onReset } = {}) {
  return el(
    "div",
    { class: "state" },
    el("span", { html: icon("empty", 72).innerHTML }),
    el("p", { class: "state__title", text: title }),
    el("p", { class: "state__desc", text: desc }),
    onReset ? el("button", { class: "btn btn--ghost", type: "button", text: "重置筛选条件", onclick: onReset }) : null,
  );
}

export function errorState({ message, code, onRetry }) {
  return el(
    "div",
    { class: "state state--error", role: "alert" },
    el("span", { class: "state__title state__title--inline" }, icon("error", 16), "数据加载失败"),
    el("p", { class: "state__desc", text: message || "无法连接 GitHub API。若此前已缓存数据，已自动回退到本地快照。" }),
    code ? el("div", { class: "state__code", text: code }) : null,
    el(
      "div",
      { class: "state__actions" },
      onRetry ? el("button", { class: "btn btn--danger", type: "button", text: "重试请求", onclick: onRetry }) : null,
      el("a", { class: "btn btn--ghost", href: "./README.md", text: "查看部署与限流说明" }),
    ),
  );
}

export function rateLimitState({ limit, remaining, reset }) {
  const resetTime = reset ? new Date(reset).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
  return el(
    "div",
    { class: "card state state--rate", role: "alert" },
    el(
      "span",
      { class: "state__title state__title--inline" },
      icon("warn", 18),
      "GitHub API 速率限制提醒",
    ),
    el("p", {
      class: "state__desc",
      text: "匿名请求额度为每小时 60 次，已用完。当前展示的是本地缓存数据，配额重置后会自动恢复直连。",
    }),
    el(
      "div",
      { class: "rate-metrics" },
      el("div", {}, el("span", { text: "已用额度" }), el("strong", { class: "num", text: `${remaining} / ${limit || 60}` })),
      el("div", {}, el("span", { text: "重置时间" }), el("strong", { class: "num", text: resetTime })),
      el("div", {}, el("span", { text: "建议方案" }), el("strong", { text: "在 Actions 中配置 PAT，提升至 5000 次/时" })),
    ),
  );
}

/* ---------------- 骨架表格 ---------------- */

export function skeletonRows(count = 6) {
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "div",
      { class: "skeleton-row" },
      ...Array.from({ length: count * 2 }, () => el("div", { class: "skeleton" })),
    ),
  );
}

/* ---------------- 周期切换 ---------------- */

export function renderPeriodTabs(current, onChange) {
  return el(
    "div",
    { class: "segmented", role: "group", "aria-label": "时间周期切换" },
    PERIODS.map((period) =>
      el("button", {
        type: "button",
        text: period.label,
        "aria-pressed": String(period.id === current),
        onclick: () => onChange(period.id),
      }),
    ),
  );
}

/* ---------------- 数据行 ---------------- */

/**
 * 项目单元格。
 *
 * 这里刻意不放头像/色块：GitHub Trending 官方榜单也不放，而随机配色的
 * 首字母方块（facebook/react → "FA"）既无辨识价值，又会在几十行里
 * 形成视觉噪音。项目名本身（owner/repo）已经是唯一标识。
 */
export function repoCell(repo) {
  return el(
    "div",
    { class: "repo" },
    el(
      "span",
      { class: "repo__text" },
      el("span", { class: "repo__name", text: repo.fullName }),
      el("span", { class: "repo__desc", text: repo.description || "暂无描述" }),
    ),
  );
}

export function langCell(language) {
  return el(
    "span",
    { class: "lang" },
    el("span", { class: "lang__dot", style: `background:${langColor(language)}` }),
    el("span", { text: language || "—" }),
  );
}

export function growthCell(growth, maxGrowth) {
  if (growth == null) {
    // 关键：区分「无基线」与「零增长」，不要都画成 0
    return el(
      "div",
      { class: "growth" },
      el("span", { class: "growth__value", style: "color:var(--text-tertiary)", text: "暂无基线" }),
      el("span", { class: "growth__track" }, el("span", { class: "growth__fill growth__fill--muted" })),
    );
  }
  const ratio = maxGrowth > 0 ? Math.max(6, Math.round((growth / maxGrowth) * 100)) : 6;
  return el(
    "div",
    { class: "growth" },
    el("span", { class: "growth__value num", text: `+${formatNumber(growth)}` }),
    el("span", { class: "growth__track" }, el("span", { class: "growth__fill", style: `width:${ratio}%` })),
  );
}

/* ---------------- 图表 ---------------- */

/**
 * 折线 + 面积图。用 SVG path 直接绘制，零依赖。
 * @param {{daily: number[], cumulative: number[], labels: string[]}} series
 */
export function renderTrendChart(series, { height = 300 } = {}) {
  const { daily = [], cumulative = [], labels = [] } = series;
  const yTicks = 5;

  if (!daily.length) {
    return el("div", { class: "chart chart--empty" }, emptyState({ title: "暂无增长数据", desc: "该时间窗口内没有采集到 Star 变化记录" }));
  }

  const maxDaily = Math.max(...daily, 1);
  const maxCum = Math.max(...cumulative, 1);
  // 两条线共用一个归一化轴，靠图例说明区分量级，避免误读
  const scaleMax = Math.max(maxDaily, maxCum * 0.35, 1);

  // viewBox 用真实像素尺度，避免 preserveAspectRatio 拉伸导致描边变形
  const H = 240;
  const W = Math.max(240, daily.length * 9);
  const stepX = daily.length > 1 ? W / (daily.length - 1) : W;

  const toPoints = (values) =>
    values
      .map((value, index) => {
        const x = (index * stepX).toFixed(1);
        const y = (H - (value / scaleMax) * H).toFixed(1);
        return `${x},${y}`;
      })
      .join(" ");

  const dailyPoints = toPoints(daily);
  const cumPoints = toPoints(cumulative);
  const lastY = (H - (daily[daily.length - 1] / scaleMax) * H).toFixed(1);

  return el(
    "div",
    { class: "chart", style: `height:${height}px` },
    el(
      "div",
      { class: "chart__axis-y" },
      ...Array.from({ length: yTicks }, (_, i) => {
        const value = scaleMax * (1 - i / (yTicks - 1));
        return el("span", { class: "num", text: formatNumber(Math.round(value)) });
      }),
    ),
    el(
      "div",
      { class: "chart__plot" },
      el("div", {
        class: "chart__canvas",
        // 不用 preserveAspectRatio="none"：那会把描边拉变形。
        // 改用固定 viewBox 宽度按实际数据量自适应，坐标轴用 CSS 网格对齐。
        html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Star 增长趋势折线图">
          ${[0, 0.25, 0.5, 0.75, 1]
            .map((t) => `<line x1="0" y1="${(t * H).toFixed(1)}" x2="${W}" y2="${(t * H).toFixed(1)}" stroke="var(--border-subtle)" stroke-width="1" vector-effect="non-scaling-stroke"/>`)
            .join("")}
          <polyline points="${cumPoints}" fill="none" stroke="var(--success)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
          <polyline points="${dailyPoints}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${W}" cy="${lastY}" r="3" fill="var(--accent)" stroke="var(--bg-card)" stroke-width="2"/>
        </svg>`,
      }),
      el(
        "div",
        { class: "chart__axis-x" },
        ...(labels.length ? labels.map((label, i) => el("span", { class: i === labels.length - 1 ? "num" : "num", text: label })) : []),
      ),
    ),
  );
}

export function chartLegend() {
  return el(
    "div",
    { class: "legend" },
    el("span", { class: "legend__item" }, el("span", { class: "legend__swatch" }), "每日新增 Star"),
    el("span", { class: "legend__item" }, el("span", { class: "legend__swatch legend__swatch--dash" }), "累计 Star 总数"),
  );
}

/* ---------------- KPI ---------------- */

/**
 * KPI 卡片。
 *
 * 关键点：不做四个一模一样的等权卡片。primary=true 的那张承担视觉焦点
 * （更大数字、主色左边框、无边框），其余降级为次级信息 —— 这是成熟
 * 仪表盘的做法，也打破了「千篇一律的四等分网格」。
 */
export function kpi({ label, value, delta, deltaKind = "up", hint, primary = false }) {
  // 「暂无基线」这类占位文案不该用 30px 的数字字号，单独降一档
  const isPlaceholder = typeof value === "string" && !/^[-+]?[\d,.]+%?$/.test(value.trim());
  return el(
    "div",
    { class: primary ? "kpi kpi--primary" : "kpi" },
    el("span", { class: "kpi__label", text: label }),
    el("span", {
      class: isPlaceholder ? "kpi__value kpi__value--placeholder" : "kpi__value num",
      text: value,
    }),
    delta ? el("span", { class: `kpi__delta kpi__delta--${deltaKind}`, text: delta }) : null,
    hint ? el("span", { class: "kpi__hint", text: hint }) : null,
  );
}

/* ---------------- 缓存健康度 ---------------- */

export function cacheStatusCard(snapshot, source) {
  const sourceLabel = { static: "静态快照（Actions 构建）", local: "浏览器本地缓存", live: "实时 API 直连" }[source] || source;
  const hasBaseline = Boolean(snapshot.baselineAt);
  return el(
    "div",
    { class: "card" },
    el("h2", { class: "card__title", text: "数据源与缓存状态" }),
    el(
      "div",
      { class: "status-list" },
      statusItem("ok", "数据来源", sourceLabel),
      statusItem("ok", "数据生成时间", `${clockLabel(snapshot.generatedAt)} · ${freshnessLabel(snapshot.generatedAt)}`),
      statusItem(
        hasBaseline ? "ok" : "warn",
        "Star 增长基线",
        hasBaseline ? `基线快照 ${freshnessLabel(snapshot.baselineAt)}` : "暂无历史基线 · 增长量显示为「暂无基线」",
      ),
      statusItem("ok", "缓存策略", "每 2 小时由 GitHub Actions 落盘一次"),
    ),
  );
}

function statusItem(kind, name, desc) {
  return el(
    "div",
    { class: "status-list__item" },
    el("span", { class: `dot dot--${kind}` }),
    el(
      "span",
      { class: "status-list__body" },
      el("span", { class: "status-list__name", text: name }),
      el("span", { class: `status-list__desc${kind === "warn" ? " status-list__desc--warn" : ""}`, text: desc }),
    ),
  );
}

/* ---------------- 页脚 ---------------- */

export function renderFooter() {
  return el(
    "footer",
    { class: "foot" },
    el("span", { text: "数据来源 GitHub REST API · 每 2 小时自动缓存更新 · 本地快照优先，限流时自动降级" }),
    el(
      "span",
      { class: "foot__links" },
      el("a", { href: "./docs/API.md", text: "API 限流说明" }),
      el("a", { href: "./docs/DEPLOY.md", text: "部署文档" }),
      el("span", { class: "foot__version", text: "v1.2.0" }),
    ),
  );
}

/* ---------------- 对比托盘 ---------------- */

export function renderCompareTray(list, { onOpen, onClear, onRemove }) {
  const tray = el("aside", { class: "tray", id: "compare-tray", hidden: list.length === 0, "aria-label": "对比项目列表" });
  if (!list.length) return tray;

  tray.append(
    el("span", { class: "tray__title", text: `对比清单（${list.length}/4）` }),
    el(
      "div",
      { class: "tray__list" },
      list.map((name) =>
        el(
          "span",
          { class: "tray__item" },
          el("span", { text: name }),
          el("button", { class: "tray__remove", type: "button", "aria-label": `移出对比 ${name}`, onclick: () => onRemove(name) }, icon("x", 12)),
        ),
      ),
    ),
    el("span", { class: "tray__spacer" }),
    el("button", { class: "btn btn--ghost", type: "button", text: "清空", onclick: onClear }),
    el("button", { class: "btn btn--primary", type: "button", text: "开始对比", onclick: onOpen }),
  );
  return tray;
}

/* ---------------- 相对时间工具再导出 ---------------- */

export { relativeTime };
