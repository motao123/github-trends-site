/**
 * 页面四：我的收藏。
 */

import { loadSnapshot } from "../lib/data.js";
import { getFavorites, toggleFavorite, getCompare, toggleCompare, COMPARE_LIMIT } from "../lib/store.js";
import { el, mount, icon, formatNumber, relativeTime, toast, exportCsv } from "../lib/ui.js";
import { renderTopbar, bindTopbarSearch, emptyState, loadingState, repoCell, langCell, renderFooter, renderCompareTray } from "../components/ui.js";

const app = document.querySelector("#app");
let snapshot = null;

function render() {
  const names = getFavorites();
  const rows = names
    .map((name) => snapshot?.items.find((item) => item.fullName === name))
    .filter(Boolean);

  mount(
    app,
    renderTopbar("favorites"),
    el(
      "main",
      { class: "page" },
      el(
        "div",
        { class: "page-head" },
        el(
          "div",
          {},
          el("h1", { class: "page-title", text: "我的收藏" }),
          el("p", { class: "page-sub", text: "收藏保存在本机 localStorage，不上传任何服务器；快照中已下榜的项目不会展示。" }),
        ),
        el(
          "button",
          {
            class: "btn btn--ghost",
            type: "button",
            disabled: !rows.length,
            onclick: () => {
              exportCsv("github-trends-favorites.csv", rows);
              toast("收藏 CSV 已导出");
            },
          },
          icon("download", 14),
          "导出 CSV",
        ),
      ),
      rows.length
        ? el(
            "div",
            { class: "table-wrap" },
            el(
              "div",
              { class: "table-scroll" },
              el(
                "table",
                { class: "rank" },
                el("thead", {}, el("tr", {}, el("th", { text: "项目" }), el("th", { text: "主要语言" }), el("th", { style: "text-align:right", text: "Star 总数" }), el("th", { style: "text-align:right", text: "Fork" }), el("th", { style: "text-align:right", text: "最近推送" }), el("th", { style: "text-align:right", text: "操作" }))),
                el(
                  "tbody",
                  {},
                  rows.map((repo) => {
                    const inCompare = getCompare().includes(repo.fullName);
                    return el(
                      "tr",
                      {},
                      el("td", {}, el("a", { href: `./project.html?full_name=${encodeURIComponent(repo.fullName)}`, style: "color:inherit;display:block" }, repoCell(repo))),
                      el("td", {}, langCell(repo.language)),
                      el("td", { class: "num col-num", text: formatNumber(repo.stars) }),
                      el("td", { class: "num col-fork", text: formatNumber(repo.forks) }),
                      el("td", { style: "text-align:right;color:var(--text-secondary)", text: relativeTime(repo.pushedAt) }),
                      el(
                        "td",
                        { style: "text-align:right" },
                        el(
                          "span",
                          { class: "row-actions" },
                          el(
                            "button",
                            {
                              class: "compare-btn",
                              type: "button",
                              "aria-pressed": String(inCompare),
                              text: inCompare ? "对比中" : "加入对比",
                              onclick: () => {
                                const result = toggleCompare(repo.fullName);
                                if (result.reason === "limit") return toast(`对比清单最多 ${COMPARE_LIMIT} 个项目`);
                                render();
                              },
                            },
                          ),
                          el(
                            "button",
                            {
                              class: "btn btn--ghost",
                              type: "button",
                              text: "取消收藏",
                              onclick: () => {
                                toggleFavorite(repo.fullName);
                                toast("已取消收藏");
                                render();
                              },
                            },
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ),
            ),
          )
        : el(
            "div",
            { class: "table-wrap" },
            emptyState({
              title: "还没有收藏任何项目",
              desc: "在趋势榜单点击星标即可收藏，方便持续跟踪某个项目的 Star 走势",
            }),
          ),
    ),
    renderCompareTray(getCompare(), {
      onOpen: () => {
        window.location.href = "./compare.html";
      },
      onClear: () => {
        for (const name of getCompare()) toggleCompare(name);
        render();
      },
      onRemove: (name) => {
        toggleCompare(name);
        render();
      },
    }),
    renderFooter(),
  );

  bindTopbarSearch((keyword) => {
    window.location.href = `./index.html?q=${encodeURIComponent(keyword)}`;
  });
}

async function boot() {
  mount(app, renderTopbar("favorites"), el("main", { class: "page" }, loadingState()));
  try {
    snapshot = (await loadSnapshot()).snapshot;
  } catch {
    snapshot = { items: [] };
  }
  render();
}

window.addEventListener("favoriteschange", render);
window.addEventListener("comparechange", render);
boot();
