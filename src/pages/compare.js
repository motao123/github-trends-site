/**
 * 页面五：项目对比（最多 4 个）。
 */

import { loadSnapshot, buildRanking, PERIOD_MAP } from "../lib/data.js";
import { getState } from "../lib/store.js";
import { getCompare, toggleCompare, clearCompare } from "../lib/store.js";
import { el, mount, icon, formatNumber, relativeTime, langColor, toast, exportCsv } from "../lib/ui.js";
import { renderTopbar, bindTopbarSearch, emptyState, loadingState, renderFooter } from "../components/ui.js";

const app = document.querySelector("#app");
let snapshot = null;

const METRICS = [
  { key: "stars", label: "Star 总数", fmt: (v) => formatNumber(v) },
  { key: "forks", label: "Fork 数", fmt: (v) => formatNumber(v) },
  { key: "openIssues", label: "开放 Issue", fmt: (v) => formatNumber(v) },
  { key: "language", label: "主要语言", fmt: (v) => v || "—" },
  { key: "license", label: "许可证", fmt: (v) => v || "—" },
  { key: "createdAt", label: "创建时间", fmt: (v) => String(v || "—").slice(0, 10) },
  { key: "pushedAt", label: "最近推送", fmt: (v) => relativeTime(v) },
  { key: "topics", label: "话题数", fmt: (v) => String((v || []).length) },
];

function render() {
  const names = getCompare();
  const repos = names.map((name) => snapshot?.items.find((item) => item.fullName === name)).filter(Boolean);
  const period = getState().period || "week";

  mount(
    app,
    renderTopbar("compare"),
    el(
      "main",
      { class: "page" },
      el(
        "div",
        { class: "page-head" },
        el(
          "div",
          {},
          el("h1", { class: "page-title", text: "项目对比" }),
          el("p", { class: "page-sub", text: `最多同时对比 4 个项目 · 增长量按「${PERIOD_MAP.get(period)?.label || "周榜"}」口径统计` }),
        ),
        el(
          "div",
          { style: "display:flex;gap:10px" },
          el(
            "button",
            {
              class: "btn btn--ghost",
              type: "button",
              disabled: !repos.length,
              onclick: () => {
                exportCsv("github-trends-compare.csv", repos);
                toast("对比 CSV 已导出");
              },
            },
            icon("download", 14),
            "导出 CSV",
          ),
          el("button", { class: "btn btn--ghost", type: "button", text: "清空清单", disabled: !repos.length, onclick: () => { clearCompare(); render(); } }),
        ),
      ),
      repos.length ? renderCompareTable(repos, period) : el("div", { class: "table-wrap" }, emptyState({ title: "对比清单为空", desc: "在趋势榜单点击「加入对比」，最多可加入 4 个项目" })),
      repos.length > 1 ? renderGrowthMatrix(repos, period) : null,
    ),
    renderFooter(),
  );

  bindTopbarSearch((keyword) => {
    window.location.href = `./index.html?q=${encodeURIComponent(keyword)}`;
  });
}

function renderCompareTable(repos, period) {
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "div",
      { class: "table-scroll" },
      el(
        "table",
        { class: "rank", style: "min-width:720px" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", { text: "指标" }),
            repos.map((repo) =>
              el("th", { style: "text-align:right" },
                el("div", { style: "display:flex;align-items:center;gap:8px;justify-content:flex-end" },
                  el("span", { style: "font-weight:600;color:var(--text-primary)", text: repo.name }),
                  el("button", { class: "tag-btn", type: "button", "aria-label": `移出对比 ${repo.fullName}`, text: "×", onclick: () => { toggleCompare(repo.fullName); render(); } }),
                ),
              ),
            ),
          ),
        ),
        el(
          "tbody",
          {},
          METRICS.map((metric) =>
            el(
              "tr",
              {},
              el("td", { style: "color:var(--text-secondary)", text: metric.label }),
              repos.map((repo) => {
                const value = repo[metric.key];
                const cell = el("td", { class: metric.key === "stars" || metric.key === "forks" ? "num" : "", style: "text-align:right", text: metric.fmt(value) });
                if (metric.key === "language") {
                  cell.prepend(el("span", { class: "lang__dot", style: `background:${langColor(value)};display:inline-block;margin-right:6px;vertical-align:middle` }));
                }
                return cell;
              }),
            ),
          ),
          el(
            "tr",
            {},
            el("td", { style: "color:var(--text-secondary)", text: `${PERIOD_MAP.get(period)?.label || "本周"} Star 增长` }),
            repos.map((repo) => {
              const growth = repo.growth?.[period];
              const cell = el("td", { class: "num", style: "text-align:right", text: growth == null ? "暂无基线" : `+${formatNumber(growth)}` });
              const values = repos.map((r) => r.growth?.[period] ?? -1);
              const max = Math.max(...values);
              if (growth != null && growth === max && max > 0) {
                cell.append(el("span", { style: "margin-left:6px;color:var(--success)", text: "领先" }));
              }
              return cell;
            }),
          ),
          el(
            "tr",
            {},
            el("td", { style: "color:var(--text-secondary)", text: `${PERIOD_MAP.get(period)?.label || "本周"}榜单排名` }),
            repos.map((repo) => {
              const rows = buildRanking(snapshot, period, { sort: "growth" });
              const idx = rows.findIndex((r) => r.fullName === repo.fullName);
              return el("td", { class: "num", style: "text-align:right", text: idx >= 0 ? `No.${idx + 1}` : "未在榜" });
            }),
          ),
        ),
      ),
    ),
  );
}

/** 各周期增长横向对比条，直观看出差异。 */
function renderGrowthMatrix(repos, period) {
  const periods = ["week", "month", "quarter", "year"];
  return el(
    "section",
    { class: "card" },
    el("h2", { class: "card__title", text: "各周期 Star 增长对比" }),
    el(
      "div",
      { class: "bars" },
      periods.flatMap((pid) => {
        const values = repos.map((r) => r.growth?.[pid] ?? null);
        const max = Math.max(...values.map((v) => v ?? 0), 1);
        return [
          el(
            "div",
            { class: "bars__label", style: "margin-top:8px" },
            el("span", { class: "bars__name", text: PERIOD_MAP.get(pid).label }),
          ),
          ...repos.map((repo, index) =>
            el(
              "div",
              { class: "bars__item" },
              el(
                "div",
                { class: "bars__label" },
                el("span", { class: "bars__name", style: "font-weight:400;color:var(--text-secondary)", text: repo.fullName }),
                el("span", { class: "bars__value", text: values[index] == null ? "暂无基线" : `+${formatNumber(values[index])}` }),
              ),
              el(
                "div",
                { class: "bars__track" },
                el("span", { class: "bars__fill", style: `width:${values[index] == null ? 0 : Math.max(3, Math.round((values[index] / max) * 100))}%;background:var(--accent)` }),
              ),
            ),
          ),
        ];
      }),
    ),
  );
}

async function boot() {
  mount(app, renderTopbar("compare"), el("main", { class: "page" }, loadingState()));
  try {
    snapshot = (await loadSnapshot()).snapshot;
  } catch {
    snapshot = { items: [] };
  }
  render();
}

window.addEventListener("comparechange", render);
boot();
