/**
 * 页面一：趋势榜单。
 */

import { loadSnapshot, buildRanking, allLanguages, allTopics, PERIOD_MAP, freshnessLabel, clockLabel, clearLocalCache } from "../lib/data.js";
import { getState, setState, resetState, getFavorites, toggleFavorite, getCompare, toggleCompare, clearCompare, COMPARE_LIMIT } from "../lib/store.js";
import { RateLimitError } from "../lib/github-api.js";
import { el, mount, icon, formatNumber, relativeTime, toast, exportCsv } from "../lib/ui.js";
import {
  renderTopbar,
  bindTopbarSearch,
  loadingState,
  emptyState,
  errorState,
  rateLimitState,
  skeletonRows,
  renderPeriodTabs,
  repoCell,
  langCell,
  growthCell,
  kpi,
  renderFooter,
  renderCompareTray,
} from "../components/ui.js";

const app = document.querySelector("#app");

let snapshot = null;
let snapshotSource = "local";
let ranking = [];
let rateLimitInfo = null;

function render() {
  const state = getState();
  const maxGrowth = ranking.reduce((acc, r) => Math.max(acc, r.periodGrowth ?? 0), 0);
  const paged = ranking.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  const totalPages = Math.max(1, Math.ceil(ranking.length / state.pageSize));

  mount(
    app,
    renderTopbar("leaderboard"),
    el(
      "main",
      { class: "page" },
      // 标题 + 周期
      el(
        "div",
        { class: "page-head" },
        el(
          "div",
          {},
          el("h1", { class: "page-title", text: "开源项目趋势榜单" }),
          el("p", { class: "page-sub", text: "基于 GitHub REST API 的周期热度统计 · Star 增长量反映真实 trending" }),
        ),
        renderPeriodTabs(state.period, (period) => setState({ period, page: 1 })),
      ),
      // 筛选栏
      renderToolbar(state),
      // KPI
      renderKpis(state),
      // 限流提示（有则显示）
      rateLimitInfo ? rateLimitState(rateLimitInfo) : null,
      // 表格
      renderTable(state, paged, maxGrowth),
      renderPagination(state, totalPages),
    ),
    renderCompareTray(getCompare(), {
      onOpen: () => {
        window.location.href = "./compare.html";
      },
      onClear: () => {
        clearCompare();
        render();
      },
      onRemove: (name) => {
        toggleCompare(name);
        render();
      },
    }),
    renderFooter(),
  );
}

function renderToolbar(state) {
  const languages = ["", ...allLanguages(snapshot)];
  const topics = allTopics(snapshot);

  return el(
    "div",
    { class: "toolbar", role: "search" },
    el("span", { class: "toolbar__label", text: "语言" }),
    el(
      "select",
      {
        class: "select",
        "aria-label": "按语言筛选",
        onchange: (e) => setState({ language: e.target.value, page: 1 }),
      },
      languages.map((lang) =>
        el("option", { value: lang, selected: lang === state.language, text: lang || "全部语言" }),
      ),
    ),
    el("span", { class: "toolbar__label", text: "话题" }),
    ...topics.map(({ topic }) =>
      el("button", {
        class: "chip",
        type: "button",
        text: topic,
        "aria-pressed": String(state.topics.includes(topic)),
        onclick: () => {
          const next = state.topics.includes(topic)
            ? state.topics.filter((t) => t !== topic)
            : [...state.topics, topic];
          setState({ topics: next, page: 1 });
        },
      }),
    ),
    el("span", { class: "toolbar__spacer" }),
    el("span", { class: "toolbar__label", text: "排序" }),
    el(
      "select",
      {
        class: "select",
        "aria-label": "排序字段",
        onchange: (e) => setState({ sort: e.target.value, page: 1 }),
      },
      [
        ["growth", "Star 增长量"],
        ["stars", "Star 总数"],
        ["forks", "Fork 数"],
        ["updated", "最近推送"],
        ["created", "创建时间"],
      ].map(([value, label]) => el("option", { value, selected: value === state.sort, text: label })),
    ),
    el(
      "button",
      {
        class: "btn btn--ghost",
        type: "button",
        onclick: () => setState({ direction: state.direction === "desc" ? "asc" : "desc" }),
      },
      state.direction === "desc" ? "降序" : "升序",
    ),
    el(
      "button",
      {
        class: "btn btn--ghost",
        type: "button",
        onclick: () => {
          exportCsv(`github-trends-${state.period}.csv`, ranking);
          toast("CSV 已导出");
        },
      },
      icon("download", 14),
      "导出 CSV",
    ),
  );
}

function renderKpis(state) {
  const period = PERIOD_MAP.get(state.period);
  const rows = ranking;
  const growthSum = rows.reduce((acc, r) => acc + (r.periodGrowth ?? 0), 0);
  const hasBaseline = Boolean(snapshot.baselineAt);
  const maxPeriod = Math.max(...rows.map((r) => r.periodGrowth ?? 0), 0);

  return el(
    "div",
    { class: "kpi-row" },
    kpi({
      label: `${period.label}新增 Star`,
      value: formatNumber(growthSum),
      delta: hasBaseline ? "基于上一次快照计算" : "暂无基线 · 明日起可计算增长",
      deltaKind: hasBaseline ? "up" : "down",
    }),
    kpi({ label: "在榜项目数", value: formatNumber(rows.length), hint: `窗口内按 Star 排序取前 ${rows.length} 个` }),
    kpi({
      label: "单项目最高增长",
      value: formatNumber(maxPeriod),
      hint: maxPeriod ? ranking.find((r) => r.periodGrowth === maxPeriod)?.fullName || "" : "暂无数据",
    }),
    kpi({
      label: "数据更新时间",
      value: clockLabel(snapshot.generatedAt),
      delta: `缓存新鲜度 · ${freshnessLabel(snapshot.generatedAt)}`,
      deltaKind: "up",
    }),
  );
}

/**
 * 列定义。cls 与 CSS 中的 .col-* 一一对应 —— 因为 table-layout: fixed 只认
 * 首行（表头）的宽度声明，数据行的 class 必须同名才不会出现错位。
 */
const COLUMNS = [
  { key: "rank", label: "#", sortable: false, cls: "col-rank" },
  { key: "fullName", label: "项目", sortable: true, cls: "col-repo" },
  { key: "language", label: "主要语言", sortable: false, cls: "col-lang" },
  { key: "stars", label: "Star 总数", sortable: true, cls: "col-num", align: "right" },
  { key: "periodGrowth", label: "", sortable: true, cls: "col-growth" },
  { key: "forks", label: "Fork", sortable: true, cls: "col-fork", align: "right" },
  { key: "pushedAt", label: "最近更新", sortable: false, cls: "col-updated", align: "right" },
  { key: "actions", label: "操作", sortable: false, cls: "col-actions", align: "right" },
];

/** 周期名会随切换变化，因此在渲染时再取值，避免模块加载期就锁定周期。 */
function columnsFor(periodId) {
  const label = PERIOD_MAP.get(periodId)?.label || "周";
  return COLUMNS.map((col) => (col.key === "periodGrowth" ? { ...col, label: `${label}增长` } : col));
}

function renderTable(state, rows, maxGrowth) {
  if (!rows.length) {
    return el(
      "div",
      { class: "table-wrap" },
      emptyState({
        onReset: () => {
          resetState();
          toast("筛选条件已重置");
        },
      }),
    );
  }

  const favorites = getFavorites();
  const compare = getCompare();
  const columns = columnsFor(state.period);

  const thead = el(
    "thead",
    {},
    el(
      "tr",
      {},
      columns.map((col) =>
        el(
          "th",
          {
            class: `${col.cls}${col.sortable ? " is-sortable" : ""}`,
            style: col.align === "right" ? "text-align:right" : "",
            "aria-sort": state.sort === col.key ? (state.direction === "desc" ? "descending" : "ascending") : null,
            onclick: col.sortable
              ? () =>
                  setState({
                    sort: col.key,
                    direction: state.sort === col.key && state.direction === "desc" ? "asc" : "desc",
                    page: 1,
                  })
              : null,
          },
          col.label,
          col.sortable ? el("span", { class: "sort-arrow", text: state.sort === col.key ? (state.direction === "desc" ? "↓" : "↑") : "↕" }) : null,
        ),
      ),
    ),
  );

  const tbody = el(
    "tbody",
    {},
    rows.map((repo, index) => {
      const absoluteRank = (state.page - 1) * state.pageSize + index + 1;
      const isFav = favorites.includes(repo.fullName);
      const inCompare = compare.includes(repo.fullName);

      const favBtn = el("button", {
        class: "tag-btn",
        type: "button",
        "aria-pressed": String(isFav),
        "aria-label": isFav ? `取消收藏 ${repo.fullName}` : `收藏 ${repo.fullName}`,
        title: isFav ? "取消收藏" : "收藏",
        onclick: () => {
          const added = toggleFavorite(repo.fullName);
          toast(added ? `已收藏 ${repo.fullName}` : `已取消收藏 ${repo.fullName}`);
          render();
        },
      });
      mount(favBtn, icon(isFav ? "starFill" : "star", 14));

      const cmpBtn = el("button", {
        class: "compare-btn",
        type: "button",
        "aria-pressed": String(inCompare),
        text: inCompare ? "对比中" : "加入对比",
        onclick: () => {
          const result = toggleCompare(repo.fullName);
          if (result.reason === "limit") {
            toast(`对比清单最多 ${COMPARE_LIMIT} 个项目`);
            return;
          }
          toast(result.added ? `已加入对比：${repo.fullName}` : `已移出对比：${repo.fullName}`);
          render();
        },
      });

      return el(
        "tr",
        {},
        el("td", { class: "col-rank" }, el("span", { class: `rank-badge${absoluteRank > 3 ? " rank-badge--muted" : ""}`, text: String(absoluteRank) })),
        el("td", { class: "col-repo" }, el("a", { href: `./project.html?full_name=${encodeURIComponent(repo.fullName)}`, style: "color:inherit;display:block" }, repoCell(repo))),
        el("td", { class: "col-lang" }, langCell(repo.language)),
        el("td", { class: "num col-num", text: formatNumber(repo.stars) }),
        el("td", { class: "col-growth" }, growthCell(repo.periodGrowth, maxGrowth)),
        el("td", { class: "num col-fork", text: formatNumber(repo.forks) }),
        el("td", { class: "col-updated", style: "color:var(--text-secondary)", text: relativeTime(repo.pushedAt) }),
        el("td", { class: "col-actions" }, el("span", { style: "display:inline-flex;gap:6px;align-items:center;justify-content:flex-end" }, favBtn, cmpBtn)),
      );
    }),
  );

  return el("div", { class: "table-wrap" }, el("div", { class: "table-scroll" }, el("table", { class: "rank" }, thead, tbody)));
}

function renderPagination(state, totalPages) {
  if (!ranking.length) return null;
  const from = (state.page - 1) * state.pageSize + 1;
  const to = Math.min(state.page * state.pageSize, ranking.length);

  const pageButtons = [];
  const add = (page) =>
    pageButtons.push(
      el("button", {
        type: "button",
        text: String(page),
        "aria-current": page === state.page ? "true" : null,
        onclick: () => setState({ page }),
      }),
    );

  add(1);
  if (state.page > 3) pageButtons.push(el("span", { text: "···", style: "color:var(--text-tertiary)" }));
  for (let p = Math.max(2, state.page - 1); p <= Math.min(totalPages, state.page + 1); p += 1) add(p);
  if (state.page < totalPages - 2) pageButtons.push(el("span", { text: "···", style: "color:var(--text-tertiary)" }));
  if (totalPages > 1) add(totalPages);

  return el(
    "div",
    { class: "table-wrap", style: "box-shadow:none;border:none;background:transparent" },
    el(
      "div",
      { class: "table-foot" },
      el("span", { class: "table-foot__info", text: `共 ${formatNumber(ranking.length)} 个项目 · 显示第 ${from}–${to} 条` }),
      el(
        "div",
        { class: "pager" },
        el("button", { type: "button", text: "‹", "aria-label": "上一页", disabled: state.page <= 1, onclick: () => setState({ page: state.page - 1 }) }),
        pageButtons,
        el("button", { type: "button", text: "›", "aria-label": "下一页", disabled: state.page >= totalPages, onclick: () => setState({ page: state.page + 1 }) }),
      ),
    ),
  );
}

async function boot() {
  mount(app, renderTopbar("leaderboard"), el("main", { class: "page" }, skeletonRows()));

  try {
    const result = await loadSnapshot();
    snapshot = result.snapshot;
    snapshotSource = result.source;
    recompute();
    render();
    bindTopbarSearch((keyword) => setState({ keyword, page: 1 }));
  } catch (err) {
    if (err instanceof RateLimitError) {
      rateLimitInfo = err.rateLimit;
      // 限流时退回缓存（哪怕过期），保证页面仍有内容可读
      try {
        const local = (await import("../lib/data.js")).readLocalCache();
        if (local) {
          snapshot = local;
          snapshotSource = "local";
          recompute();
          render();
          return;
        }
      } catch {
        /* 无缓存可用 */
      }
      mount(app, renderTopbar("leaderboard"), el("main", { class: "page" }, rateLimitState(err.rateLimit)));
      return;
    }
    mount(
      app,
      renderTopbar("leaderboard"),
      el(
        "main",
        { class: "page" },
        el(
          "div",
          { class: "table-wrap" },
          errorState({
            message: "无法从本地快照或 GitHub API 获取数据。请确认已运行过 `npm run fetch` 生成 data/trending.json，或检查网络连通性。",
            code: `${err.name || "Error"}: ${err.message}`,
            onRetry: () => boot(),
          }),
        ),
      ),
    );
  }
}

function recompute() {
  const state = getState();
  ranking = buildRanking(snapshot, state.period, {
    language: state.language,
    topics: state.topics,
    keyword: state.keyword,
    sort: state.sort,
    direction: state.direction,
  });
}

/* 状态变化 → 重算 + 重绘 */
window.addEventListener("statechange", () => {
  if (!snapshot) return;
  recompute();
  render();
  bindTopbarSearch((keyword) => setState({ keyword, page: 1 }));
});

window.addEventListener("comparechange", render);
window.addEventListener("favoriteschange", render);

boot();
