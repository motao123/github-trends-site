/**
 * 页面三：总览统计面板。
 */

import { loadSnapshot, summarize, languageDistribution, buildRanking, freshnessLabel, clockLabel } from "../lib/data.js";
import { getState, setState } from "../lib/store.js";
import { el, mount, icon, formatNumber, langColor, exportCsv, toast } from "../lib/ui.js";
import { renderTopbar, bindTopbarSearch, loadingState, kpi, cacheStatusCard, renderFooter, skeletonRows } from "../components/ui.js";

const app = document.querySelector("#app");

let snapshot = null;
let source = "local";
let summary = null;
let dist = [];

function render() {
  const top = [];
  for (const period of ["week", "month", "quarter", "year"]) {
    top.push(...buildRanking(snapshot, period, { sort: "growth" }).slice(0, 5));
  }
  // 同项目跨周期去重，保持首次出现的位置
  const seen = new Set();
  const uniqueTop = top.filter((r) => (seen.has(r.fullName) ? false : (seen.add(r.fullName), true)));

  mount(
    app,
    renderTopbar("overview"),
    el(
      "main",
      { class: "page" },
      el(
        "div",
        { class: "page-head" },
        el(
          "div",
          {},
          el("h1", { class: "page-title", text: "总览统计面板" }),
          el("p", { class: "page-sub", text: "各周期榜单汇总 · 语言分布 · 增长排行与缓存健康度" }),
        ),
        el(
          "div",
          { style: "display:flex;gap:10px" },
          el("a", { class: "btn btn--ghost", href: "./index.html", text: "返回榜单" }),
          el(
            "button",
            {
              class: "btn btn--primary",
              type: "button",
              onclick: () => {
                exportCsv("github-trends-overview.csv", uniqueTop);
                toast("汇总 CSV 已导出");
              },
            },
            icon("download", 14),
            "导出 CSV",
          ),
        ),
      ),
      // 各周期汇总 KPI
      el(
        "div",
        { class: "kpi-row" },
        kpi({ label: "周榜新增 Star", value: formatNumber(summary.week.growth), delta: `覆盖 ${formatNumber(summary.week.count)} 个项目`, deltaKind: "up" }),
        kpi({ label: "月榜新增 Star", value: formatNumber(summary.month.growth), delta: `覆盖 ${formatNumber(summary.month.count)} 个项目`, deltaKind: "up" }),
        kpi({ label: "季度新增 Star", value: formatNumber(summary.quarter.growth), delta: `覆盖 ${formatNumber(summary.quarter.count)} 个项目`, deltaKind: "up" }),
        kpi({ label: "年度新增 Star", value: formatNumber(summary.year.growth), delta: `覆盖 ${formatNumber(summary.year.count)} 个项目`, deltaKind: "up" }),
      ),
      // 语言分布
      el(
        "section",
        { class: "card" },
        el(
          "div",
          { class: "card__head" },
          el("h2", { class: "card__title", text: "在榜项目语言分布" }),
          el("span", { class: "card__meta", text: `统计周期：周榜 · 样本 ${formatNumber(summary.week.count)} 个项目` }),
        ),
        renderBars(),
      ),
      // 排行 + 缓存健康度
      el(
        "div",
        { class: "grid-2" },
        el(
          "section",
          { class: "card" },
          el(
            "div",
            { class: "card__head" },
            el("h2", { class: "card__title", text: "Star 增长排行 TOP 5" }),
            el("a", { href: "./index.html", class: "card__meta", style: "color:var(--accent)", text: "查看完整榜单" }),
          ),
          el(
            "div",
            { class: "rank-list" },
            uniqueTop.slice(0, 5).map((row, index) =>
              el(
                "div",
                { class: "rank-list__item" },
                el("span", { class: `rank-badge${index > 2 ? " rank-badge--muted" : ""}`, text: String(index + 1) }),
                el("a", { class: "rank-list__name", href: `./project.html?full_name=${encodeURIComponent(row.fullName)}`, style: "color:inherit", text: row.fullName }),
                el("span", { class: "rank-list__value num", text: row.periodGrowth == null ? "暂无基线" : `+${formatNumber(row.periodGrowth)}` }),
              ),
            ),
          ),
        ),
        cacheStatusCard(snapshot, source),
      ),
    ),
    renderFooter(),
  );

  bindTopbarSearch((keyword) => {
    setState({ keyword, page: 1 });
    window.location.href = `./index.html?q=${encodeURIComponent(keyword)}`;
  });
}

function renderBars() {
  if (!dist.length) {
    return el("p", { class: "page-sub", text: "暂无语言分布数据" });
  }
  const max = Math.max(...dist.map((d) => d.count));
  return el(
    "div",
    { class: "bars" },
    dist.map((item) =>
      el(
        "div",
        { class: "bars__item" },
        el(
          "div",
          { class: "bars__label" },
          el(
            "span",
            { class: "bars__name" },
            el("span", { class: "lang__dot", style: `background:${langColor(item.language)}` }),
            item.language,
          ),
          el("span", { class: "bars__value", text: `${formatNumber(item.count)} 个 · ${formatPercentSafe(item.ratio)}` }),
        ),
        el(
          "div",
          { class: "bars__track" },
          el("span", { class: "bars__fill", style: `width:${Math.max(4, Math.round((item.count / max) * 100))}%;background:${langColor(item.language)}` }),
        ),
      ),
    ),
  );
}

function formatPercentSafe(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

async function boot() {
  mount(app, renderTopbar("overview"), el("main", { class: "page" }, skeletonRows()));
  try {
    const result = await loadSnapshot();
    snapshot = result.snapshot;
    source = result.source;
    summary = summarize(snapshot);
    dist = languageDistribution(snapshot, getState().period || "week");
    render();
  } catch (err) {
    mount(
      app,
      renderTopbar("overview"),
      el(
        "main",
        { class: "page" },
        el(
          "div",
          { class: "card" },
          el(
            "div",
            { class: "state state--error" },
            el("p", { class: "state__title", text: "总览数据加载失败" }),
            el("p", { class: "state__desc", text: "请先运行 `npm run fetch` 生成 data/trending.json，或检查网络连通性。" }),
            el("div", { class: "state__code", text: `${err.name || "Error"}: ${err.message}` }),
          ),
        ),
      ),
      renderFooter(),
    );
  }
}

boot();
