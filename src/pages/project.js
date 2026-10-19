/**
 * 页面二：项目详情（含 Star 增长趋势图）。
 * 路由：project.html?full_name=owner/repo
 */

import { loadSnapshot, buildRanking, PERIODS, PERIOD_MAP, freshnessLabel } from "../lib/data.js";
import { getFavorites, toggleFavorite, getCompare, toggleCompare, getState, COMPARE_LIMIT } from "../lib/store.js";
import { fetchStarTimeline } from "../lib/github-api.js";
import { el, mount, icon, formatNumber, formatPercent, relativeTime, toast, avatarColor, initials } from "../lib/ui.js";
import {
  renderTopbar,
  loadingState,
  emptyState,
  kpi,
  renderTrendChart,
  chartLegend,
  renderFooter,
  renderCompareTray,
} from "../components/ui.js";

const app = document.querySelector("#app");
const params = new URLSearchParams(window.location.search);
const target = params.get("full_name") || "";

let snapshot = null;
let repo = null;
let chartRange = 30;

function render() {
  if (!repo) {
    mount(app, renderTopbar("leaderboard"), el("main", { class: "page" }, el("div", { class: "table-wrap" }, emptyState({ title: "未找到该项目", desc: "请从榜单页重新进入详情" }))), renderFooter());
    return;
  }

  const isFav = getFavorites().includes(repo.fullName);
  const inCompare = getCompare().includes(repo.fullName);
  const currentPeriod = getState().period || "week";
  const periodLabel = PERIOD_MAP.get(currentPeriod)?.label || "周榜";

  mount(
    app,
    renderTopbar("leaderboard"),
    // 头部信息
    el(
      "section",
      { class: "page", style: "padding-bottom:0;gap:24px" },
      el(
        "div",
        { class: "page-head", style: "align-items:flex-start" },
        el(
          "div",
          { class: "breadcrumb" },
          el("a", { href: "./index.html", text: "趋势榜单" }),
          el("span", { text: "›" }),
          el("span", { style: "color:var(--text-primary);font-weight:500", text: repo.fullName }),
        ),
        el(
          "div",
          { style: "display:flex;gap:10px" },
          el(
            "button",
            {
              class: isFav ? "btn btn--primary" : "btn btn--ghost",
              type: "button",
              onclick: () => {
                const added = toggleFavorite(repo.fullName);
                toast(added ? "已加入收藏" : "已取消收藏");
                render();
              },
            },
            icon(isFav ? "starFill" : "star", 14),
            isFav ? "已收藏" : "收藏",
          ),
          el(
            "button",
            {
              class: "btn btn--ghost",
              type: "button",
              onclick: () => {
                const result = toggleCompare(repo.fullName);
                if (result.reason === "limit") return toast(`对比清单最多 ${COMPARE_LIMIT} 个项目`);
                toast(result.added ? "已加入对比" : "已移出对比");
                render();
              },
            },
            inCompare ? "已加入对比" : "加入对比",
          ),
        ),
      ),
      el(
        "div",
        { class: "card", style: "flex-direction:row;gap:20px;align-items:flex-start" },
        el(
          "div",
          { style: "display:flex;gap:20px;flex:1;min-width:0" },
          el("span", {
            class: "repo__avatar",
            style: `width:64px;height:64px;border-radius:14px;background:${avatarColor(repo.owner)};font-size:20px`,
            text: initials(repo.fullName),
          }),
          el(
            "div",
            { style: "min-width:0;display:flex;flex-direction:column;gap:10px" },
            el("h1", { class: "page-title", style: "font-size:26px", text: repo.fullName }),
            el("p", { class: "page-sub", style: "max-width:620px", text: repo.description || "该项目没有提供描述" }),
            el(
              "div",
              { style: "display:flex;gap:8px;flex-wrap:wrap" },
              ...(repo.topics || []).slice(0, 6).map((t) => el("span", { class: "chip", style: "height:26px", text: t })),
            ),
            el(
              "div",
              { style: "display:flex;gap:16px;flex-wrap:wrap;margin-top:4px" },
              el("a", { href: repo.url, target: "_blank", rel: "noopener noreferrer", text: "在 GitHub 上查看 ↗", style: "font-size:12px" }),
              repo.homepage ? el("a", { href: repo.homepage, target: "_blank", rel: "noopener noreferrer", text: "项目主页 ↗", style: "font-size:12px" }) : null,
            ),
          ),
        ),
        el(
          "div",
          { class: "kpi", style: "width:300px;flex-shrink:0;background:var(--bg-subtle)" },
          el("div", { class: "status-list__item", style: "justify-content:space-between" }, el("span", { class: "kpi__label", text: `${periodLabel}排名` }), repo.rank ? el("span", { class: "rank-badge", style: "width:auto;min-width:52px;padding:0 10px", text: `No.${repo.rank}` }) : el("span", { class: "kpi__label", text: "未在榜" })),
          metaRow("创建时间", String(repo.createdAt || "—").slice(0, 10)),
          metaRow("最近推送", relativeTime(repo.pushedAt)),
          metaRow("主要语言", repo.language),
          metaRow("许可证", repo.license),
          metaRow("话题数", String((repo.topics || []).length)),
        ),
      ),
    ),

    // KPI 行。growth 值可能为 null（尚无历史基线），必须显式区分，
    // 不能让 undefined/NaN 混进界面。
    el(
      "div",
      { class: "kpi-row kpi-row--5" },
      kpi({ label: "Star 总数", value: formatNumber(repo.stars) }),
      kpi({
        label: `${periodLabel} Star 增长`,
        value: repo.weekGrowth == null ? "暂无基线" : `+${formatNumber(repo.weekGrowth)}`,
      }),
      kpi({
        label: "近 30 日累计增长",
        value: repo.history30 == null ? "暂无基线" : `+${formatNumber(repo.history30)}`,
      }),
      kpi({ label: "Fork 数", value: formatNumber(repo.forks) }),
      kpi({ label: "开放 Issue", value: formatNumber(repo.openIssues) }),
    ),

    // 趋势图
    el(
      "section",
      { class: "card" },
      el(
        "div",
        { class: "card__head" },
        el(
          "div",
          {},
          el("h2", { class: "card__title", text: "Star 增长趋势" }),
          el("p", { class: "card__meta", text: "按日聚合 · 来源为 Actions 落盘的每日快照序列（GitHub 不提供历史 star 值）" }),
        ),
        el(
          "div",
          { style: "display:flex;gap:12px;align-items:center" },
          chartLegend(),
          el(
            "div",
            { class: "segmented" },
            [30, 90, 365].map((days) =>
              el("button", {
                type: "button",
                text: days === 365 ? "全年" : `${days} 天`,
                "aria-pressed": String(chartRange === days),
                onclick: () => {
                  chartRange = days;
                  render();
                },
              }),
            ),
          ),
        ),
      ),
      el("div", { id: "chart-host" }, loadingState("正在加载趋势序列…")),
    ),

    // 各周期成绩 + 说明
    el(
      "div",
      { class: "grid-2" },
      el(
        "section",
        { class: "card" },
        el("h2", { class: "card__title", text: "各周期榜单成绩" }),
        renderCycleTable(),
      ),
      el(
        "section",
        { class: "card" },
        el("h2", { class: "card__title", text: "统计口径说明" }),
        el(
          "ul",
          { style: "margin:0;padding-left:18px;color:var(--text-secondary);font-size:12px;line-height:1.9" },
          el("li", { text: "Star 增长量 = 当前快照 star 数 − 上一次快照 star 数，由 Actions 每 2 小时累积。" }),
          el("li", { text: "在榜判定基于 pushed 时间窗口，捕捉老项目的新版本爆发，而非只看新建仓库。" }),
          el("li", { text: "数据源为 GitHub REST API；本地快照优先，限流时自动降级并标注数据时间。" }),
          el("li", { text: `快照生成于 ${freshnessLabel(snapshot.generatedAt)}。` }),
        ),
      ),
    ),
    renderCompareTray(getCompare(), {
      onOpen: () => {
        window.location.href = "./compare.html";
      },
      onClear: () => {
        getCompare();
        window.location.reload();
      },
      onRemove: () => window.location.reload(),
    }),
    renderFooter(),
  );

  drawChart();
}

function metaRow(label, value) {
  return el(
    "div",
    { style: "display:flex;justify-content:space-between;align-items:center;gap:12px" },
    el("span", { class: "kpi__label", text: label }),
    el("span", { class: "num", style: "font-size:13px", text: value }),
  );
}

function renderCycleTable() {
  const rows = PERIODS.map((period) => ({
    period,
    stars: repo.periods?.[period.id],
    growth: repo.growth?.[period.id],
    rank: repo.ranks?.[period.id],
  })).filter((r) => r.stars != null);

  if (!rows.length) {
    return el("p", { class: "page-sub", text: "该项目未进入任何周期榜单。" });
  }

  return el(
    "table",
    { class: "mini-table" },
    el("thead", {}, el("tr", {}, el("th", { text: "周期" }), el("th", { text: "排名" }), el("th", { text: "Star 增长" }))),
    el(
      "tbody",
      {},
      rows.map((row) =>
        el(
          "tr",
          {},
          el("td", { style: row.period.id === "week" ? "color:var(--accent);font-weight:500" : "", text: `本${row.period.label}` }),
          el("td", { class: "num", text: row.rank ? `No.${row.rank}` : "—" }),
          el("td", { class: "num", style: "color:var(--success)", text: row.growth == null ? "暂无基线" : `+${formatNumber(row.growth)}` }),
        ),
      ),
    ),
  );
}

async function drawChart() {
  const host = document.querySelector("#chart-host");
  if (!host) return;
  const history = repo.history || [];

  if (history.length < 2) {
    mount(
      host,
      emptyState({
        title: "趋势序列不足",
        desc: "需要至少两个历史快照才能绘制增长曲线。GitHub Actions 每 2 小时采集一次，通常 2–3 天内可看到完整曲线。",
      }),
    );
    return;
  }

  // 按 chartRange 截取最近 N 天，snapshot 内每天一个记录
  const sliced = history.slice(-chartRange);
  const daily = sliced.map((point) => point.delta ?? 0);
  const cumulative = sliced.map((point, index) =>
    sliced.slice(0, index + 1).reduce((acc, p) => acc + (p.delta ?? 0), 0),
  );
  const labels = sliced.map((point) => String(point.date).slice(5));

  mount(host, renderTrendChart({ daily, cumulative, labels }));
}

async function boot() {
  mount(app, renderTopbar("leaderboard"), el("main", { class: "page" }, loadingState("正在加载项目详情…")));

  if (!target) {
    mount(app, renderTopbar("leaderboard"), el("main", { class: "page" }, el("div", { class: "table-wrap" }, emptyState({ title: "缺少项目参数", desc: "请通过榜单页进入项目详情" }))), renderFooter());
    return;
  }

  try {
    const result = await loadSnapshot();
    snapshot = result.snapshot;
    repo = snapshot.items.find((item) => item.fullName === target) || null;

    if (!repo) {
      mount(app, renderTopbar("leaderboard"), el("main", { class: "page" }, el("div", { class: "table-wrap" }, emptyState({ title: "未找到该项目", desc: `快照中没有 ${target}，可能它未进入当前统计窗口` }))), renderFooter());
      return;
    }

    // 计算各周期排名，并挂上历史序列
    repo.ranks = {};
    for (const period of PERIODS) {
      const rows = buildRanking(snapshot, period.id, { sort: "growth" });
      const idx = rows.findIndex((r) => r.fullName === target);
      if (idx >= 0) repo.ranks[period.id] = idx + 1;
    }
    repo.history = snapshot.history?.[target] || [];

    // 派生字段：KPI 直接读这三个值，避免在模板里做可能产生 NaN 的运算。
    const currentPeriod = getState().period || "week";
    repo.weekGrowth = repo.growth?.[currentPeriod] ?? null;
    repo.rank = repo.ranks?.[currentPeriod] ?? null;

    // 近 30 日累计：只有覆盖满 30 天才算完整，否则标为「暂无基线」
    const cutoff = Date.now() - 30 * 86400000;
    const within30 = repo.history.filter((p) => new Date(p.date).getTime() >= cutoff);
    repo.history30 =
      within30.length >= 30 ? within30.reduce((acc, p) => acc + (p.delta || 0), 0) : null;

    render();

    // 静默补充：若快照无历史序列且已配置令牌，尝试直连拉一次 stargazer 分布
    if (!repo.history.length && !getTokenSafe()) return;
    try {
      const { pages } = await fetchStarTimeline(target, 2);
      if (pages.length) {
        repo.history = deriveHistoryFromStargazers(pages);
        drawChart();
      }
    } catch {
      /* 直连失败时静默保留「趋势序列不足」提示 */
    }
  } catch (err) {
    mount(
      app,
      renderTopbar("leaderboard"),
      el("main", { class: "page" }, el("div", { class: "table-wrap" }, el("div", { class: "state state--error" }, el("p", { class: "state__title", text: "项目详情加载失败" }), el("p", { class: "state__desc", text: err.message })))),
      renderFooter(),
    );
  }
}

/** 把 stargazer 列表（每页 100 个）压缩成每日增长序列。 */
function deriveHistoryFromStargazers(pages) {
  const stars = pages.flat().map((s) => s.starred_at).filter(Boolean).sort();
  if (stars.length < 2) return [];
  const byDate = new Map();
  for (const iso of stars) {
    const day = String(iso).slice(0, 10);
    byDate.set(day, (byDate.get(day) || 0) + 1);
  }
  return [...byDate.entries()].map(([date, count]) => ({ date, delta: count }));
}

function getTokenSafe() {
  try {
    return window.localStorage.getItem("gh_trends_token") || "";
  } catch {
    return "";
  }
}

boot();
