#!/usr/bin/env node
/**
 * 构建期预渲染器 —— 本项目 SEO 的核心。
 *
 * 为什么需要它：
 *   本站是纯客户端渲染，爬虫（尤其非 Google 的爬虫、AI 抓取器）
 *   拿到的初始 HTML 只有一个空 <div id="app">。Google 虽然会执行 JS，
 *   但那是「渲染队列」里的第二遍，可能延迟数小时到数周；其他搜索引擎
 *   根本不会渲染 —— 它们看到的是一个空页面。
 *
 *   Google 在 2025 年 12 月的文档更新里明确了两点：
 *     1. 返回 404/5xx 的页面会被完全排除出渲染管线
 *     2. 动态渲染（给爬虫单独返回预渲染 HTML）已被正式标记为过时方案
 *
 *   官方推荐的是 SSG / SSR。对本项目（纯静态 + 数据定期更新），
 *   SSG 是最合适的：构建期把真实榜单内容写进 HTML，爬虫拿到即完整。
 *
 * 做什么：
 *   1. 读 public/data/trending.json
 *   2. 为每个周期生成一份含真实表格行的静态 HTML
 *   3. 注入完整的 SEO 元信息（canonical / OG / Twitter / JSON-LD）
 *   4. 生成 sitemap.xml、robots.txt、RSS 2.0、Atom 1.0
 *
 * 关键设计：
 *   预渲染的内容放在 <noscript> 之外的独立容器里，并用 <template> 承载，
 *   客户端 JS 启动后会清空它并接管渲染 —— 不会重复显示，
 *   也不会因为 JS 失败而让内容消失。
 *
 * 用法：
 *   node scripts/prerender.mjs
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SNAPSHOT = resolve(ROOT, "public/data/trending.json");
const OUT_DIR = resolve(ROOT, "_prerendered");

/* ------------------------------------------------------------------ */
/* 站点常量                                                            */
/* ------------------------------------------------------------------ */

const SITE_URL = "https://motao123.github.io/github-trends-site";
const SITE_NAME = "开源趋势站";
const SITE_LANG = "zh-CN";
const TWITTER_HANDLE = "@motao_dev";

const PERIODS = [
  { id: "week", label: "周", days: 7 },
  { id: "month", label: "月", days: 30 },
  { id: "quarter", label: "季度", days: 90 },
  { id: "half", label: "半年", days: 180 },
  { id: "year", label: "年度", days: 365 },
];

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatNumber = (n) => {
  if (n == null) return "—";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const rfc822 = (iso) => new Date(iso).toUTCString();
const isoDate = (iso) => new Date(iso).toISOString();

/** 计算两个日期之间相差的天数（按 UTC 日历日）。 */
const dayDiff = (a, b) =>
  Math.round(
    (new Date(`${b.slice(0, 10)}T00:00:00Z`) - new Date(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000,
  );

/* ------------------------------------------------------------------ */
/* 数据处理（与 src/lib/data.js 的 buildRanking 保持同一口径）        */
/* ------------------------------------------------------------------ */

/**
 * 构造周期排名。
 * 必须与前端 buildRanking 口径一致，否则预渲染内容与客户端渲染不符。
 */
function buildRanking(snapshot, periodId) {
  const rows = snapshot.items
    .map((repo) => ({
      ...repo,
      periodStars: repo.periods?.[periodId] ?? null,
      periodGrowth: repo.growth?.[periodId] ?? null,
    }))
    .filter((repo) => repo.periodStars != null);

  const nullRank = (v) => (v == null ? 1 : 0);
  rows.sort((a, b) => {
    const na = nullRank(a.periodGrowth);
    const nb = nullRank(b.periodGrowth);
    if (na !== nb) return na - nb;
    const cmp = (b.periodGrowth ?? 0) - (a.periodGrowth ?? 0);
    if (cmp === 0) return a.fullName.localeCompare(b.fullName, "en");
    return cmp;
  });
  return rows;
}

function summarize(snapshot) {
  const totals = {};
  for (const period of PERIODS) {
    const rows = buildRanking(snapshot, period.id);
    totals[period.id] = {
      count: rows.length,
      growth: rows.reduce((acc, r) => acc + (r.periodGrowth ?? 0), 0),
      top: rows[0] || null,
    };
  }
  return totals;
}

function languageDistribution(snapshot, periodId) {
  const rows = buildRanking(snapshot, periodId);
  const map = new Map();
  for (const row of rows) {
    const key = row.language || "其他";
    map.set(key, (map.get(key) || 0) + 1);
  }
  const total = rows.length || 1;
  return [...map.entries()]
    .map(([language, count]) => ({ language, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* HTML 片段生成                                                        */
/* ------------------------------------------------------------------ */

/** 渲染榜单表格行（与客户端 repoCell/growthCell 结构一致）。 */
function renderTableRows(rows, maxGrowth) {
  return rows
    .map((row, index) => {
      const growth = row.periodGrowth;
      const growthText = growth == null ? "暂无基线" : `+${formatNumber(growth)}`;
      const ratio = maxGrowth > 0 && growth != null ? Math.max(6, Math.round((growth / maxGrowth) * 100)) : 0;
      return `      <tr>
        <td class="col-rank"><span class="rank-badge${index < 3 ? " rank-badge--top" : ""}">${index + 1}</span></td>
        <td class="col-repo">
          <div class="repo">
            <span class="repo__text">
              <a class="repo__name" href="${SITE_URL}/project/${encodeURIComponent(row.fullName.split("/")[0])}/${encodeURIComponent(row.fullName.split("/").slice(1).join("/"))}.html">${esc(row.fullName)}</a>
              <span class="repo__desc">${esc(row.description || "暂无描述")}</span>
            </span>
          </div>
        </td>
        <td class="col-lang"><span class="lang"><span class="lang__dot"></span>${esc(row.language || "—")}</span></td>
        <td class="col-num num">${formatNumber(row.periodStars)}</td>
        <td class="col-growth">
          <div class="growth">
            <span class="growth__value num">${esc(growthText)}</span>
            <span class="growth__track"><span class="growth__fill${growth == null ? " growth__fill--muted" : ""}" style="width:${ratio}%"></span></span>
          </div>
        </td>
        <td class="col-fork num">${formatNumber(row.forks)}</td>
        <td class="col-updated num">${esc((row.pushedAt || "").slice(5, 10))}</td>
      </tr>`;
    })
    .join("\n");
}

/** 渲染语言分布条。 */
function renderLanguageBars(distribution) {
  return distribution
    .map(
      (item) => `        <div class="bars__item">
          <div class="bars__label">
            <span class="bars__name">${esc(item.language)}</span>
            <span class="bars__value num">${item.count}</span>
          </div>
          <div class="bars__track"><div class="bars__fill" style="width:${(item.ratio * 100).toFixed(1)}%"></div></div>
        </div>`,
    )
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* 预渲染页面内容                                                      */
/* ------------------------------------------------------------------ */

/**
 * 构造预渲染内容块。
 *
 * 用 <template> 承载：浏览器不会渲染 template 内容，
 * 客户端 JS 启动后把 app 容器内容替换掉即可，template 留在 DOM 里也无害。
 */
function renderPrerenderedContent(snapshot, period) {
  const rows = buildRanking(snapshot, period.id);
  const maxGrowth = rows.reduce((acc, r) => Math.max(acc, r.periodGrowth ?? 0), 0);
  const totals = summarize(snapshot);
  const stat = totals[period.id];
  const distribution = languageDistribution(snapshot, period.id);
  const top = stat.top;

  // 只渲染前 50 行 —— 完整榜单仍由客户端渲染，预渲染负责让爬虫看到实质内容
  const preview = rows.slice(0, 50);

  return `
    <div class="prerender-block" id="prerendered">
      <div class="prerender-inner">
        <section class="page-head">
          <div>
            <h1 class="page-title">开源项目${period.label}榜趋势榜</h1>
            <p class="page-sub">基于 GitHub REST API 的${period.label}榜热度统计 · 共 ${formatNumber(stat.count)} 个在榜项目 · 本期新增 Star 合计 ${formatNumber(stat.growth)}</p>
          </div>
        </section>

        <section class="kpi-row kpi-row--5">
          <div class="kpi kpi--primary">
            <span class="kpi__label">在榜项目数</span>
            <span class="kpi__value num">${formatNumber(stat.count)}</span>
          </div>
          <div class="kpi">
            <span class="kpi__label">${period.label}榜新增 Star</span>
            <span class="kpi__value num">${formatNumber(stat.growth)}</span>
          </div>
          <div class="kpi">
            <span class="kpi__label">榜首项目</span>
            <span class="kpi__value kpi__value--placeholder">${esc(top ? top.fullName : "—")}</span>
          </div>
          <div class="kpi">
            <span class="kpi__label">榜首增长</span>
            <span class="kpi__value num">${top && top.periodGrowth != null ? `+${formatNumber(top.periodGrowth)}` : "—"}</span>
          </div>
          <div class="kpi">
            <span class="kpi__label">快照时间</span>
            <span class="kpi__value kpi__value--placeholder">${esc(isoDate(snapshot.generatedAt).slice(0, 16).replace("T", " "))}</span>
          </div>
        </section>

        <div class="table-wrap">
          <div class="table-scroll">
            <table class="rank">
              <caption class="sr-only">${period.label}榜开源项目 Star 增长排行（前 ${preview.length} 项，共 ${formatNumber(stat.count)} 项）</caption>
              <thead>
                <tr>
                  <th class="col-rank" scope="col">#</th>
                  <th class="col-repo" scope="col">项目</th>
                  <th class="col-lang" scope="col">主要语言</th>
                  <th class="col-num" scope="col">Star 总数</th>
                  <th class="col-growth" scope="col">${period.label}榜增长</th>
                  <th class="col-fork" scope="col">Fork</th>
                  <th class="col-updated" scope="col">最近推送</th>
                </tr>
              </thead>
              <tbody>
${renderTableRows(preview, maxGrowth)}
              </tbody>
            </table>
          </div>
          <div class="table-foot">
            <span class="table-foot__info">共 ${formatNumber(stat.count)} 个项目 · 预渲染前 ${preview.length} 条 · 完整榜单由前端加载</span>
          </div>
        </div>

        <div class="grid-2">
          <section class="card">
            <h2 class="card__title">主要语言分布</h2>
            <div class="bars">
${renderLanguageBars(distribution)}
            </div>
          </section>
          <section class="card">
            <h2 class="card__title">关于本站</h2>
            <ul class="note-list">
              <li>数据源为 GitHub REST API，由 GitHub Actions 每 2 小时自动抓取并落盘。</li>
              <li>Star 增长量 = 该周期窗口内每日增长量之和，随快照逐日累积。</li>
              <li>在榜判定基于 pushed 时间窗口，捕捉老项目的新版本爆发。</li>
              <li>当前快照生成于 ${esc(isoDate(snapshot.generatedAt))}。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* SEO 元信息                                                          */
/* ------------------------------------------------------------------ */

/** 构造 <head> 里的 SEO 元信息。 */
function buildHeadTags({ title, description, canonical, ogType = "website", jsonLd = null, extra = "" }) {
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,

    // Open Graph
    `<meta property="og:type" content="${esc(ogType)}" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:locale" content="zh_CN" />`,

    // Twitter
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="${esc(TWITTER_HANDLE)}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,

    // 订阅源自动发现 —— 浏览器与阅读器据此找到 feed
    `<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)} · RSS 2.0" href="${SITE_URL}/feed.xml" />`,
    `<link rel="alternate" type="application/atom+xml" title="${esc(SITE_NAME)} · Atom 1.0" href="${SITE_URL}/atom.xml" />`,

    // 图标与清单
    `<link rel="icon" href="${SITE_URL}/favicon.svg" type="image/svg+xml" />`,
    `<link rel="apple-touch-icon" href="${SITE_URL}/favicon.svg" />`,
    `<meta name="theme-color" content="#3e63dd" />`,
  ];

  if (jsonLd) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>`);
  }
  if (extra) tags.push(extra);

  return tags.join("\n    ");
}

/** WebSite + 搜索框的结构化数据。 */
function websiteJsonLd(snapshot) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "开源项目趋势榜",
    url: `${SITE_URL}/`,
    description: "基于 GitHub REST API 的开源项目周期热度统计，提供周榜、月榜、季度、半年与年度榜单。",
    inLanguage: SITE_LANG,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/index.html?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** ItemList 结构化数据（榜单页）。 */
function itemListJsonLd(rows, period) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `开源项目${period.label}榜趋势`,
    description: `按 ${period.label}榜 Star 增长量排序的开源项目榜单`,
    numberOfItems: rows.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: rows.slice(0, 50).map((row, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/project/${encodeURIComponent(row.fullName.split("/")[0])}/${encodeURIComponent(row.fullName.split("/").slice(1).join("/"))}.html`,
      name: row.fullName,
    })),
  };
}

/** BreadcrumbList 结构化数据（详情页）。 */
function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** SoftwareApplication 结构化数据（项目详情页）。 */
function softwareJsonLd(repo, period) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: repo.name,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    description: repo.description || `${repo.fullName} 的开源项目详情与热度统计`,
    url: `${SITE_URL}/project/${encodeURIComponent(repo.fullName.split("/")[0])}/${encodeURIComponent(repo.fullName.split("/").slice(1).join("/"))}.html`,
    codeRepository: repo.url,
    author: {
      "@type": "Organization",
      name: repo.owner,
      url: `https://github.com/${repo.owner}`,
    },
    ...(repo.stars ? { interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/LikeAction",
      userInteractionCount: repo.stars,
    } } : {}),
    ...(repo.language ? { programmingLanguage: repo.language } : {}),
    ...(repo.license ? { license: repo.license } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 页面生成                                                            */
/* ------------------------------------------------------------------ */


/**
 * 从 start 位置开始做 div 标签配平，返回与外层 div 匹配的 </div> 的起始下标。
 *
 * app 容器内部可能含有嵌套 div（index.html 的 noscript 里就有），
 * 直接用 indexOf("</div>") 会匹配到内层的那个。
 */
function findMatchingDivClose(html, start) {
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth === 0) return m.index;
    } else if (!m[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return -1;
}

/** 从原始 HTML 中提取 head 内的公共部分（样式、主题脚本等）。 */
function extractShell(html) {
  const headStart = html.indexOf("<head>");
  const headEnd = html.indexOf("</head>");
  const head = headStart >= 0 && headEnd > headStart ? html.slice(headStart + 6, headEnd) : "";

  const bodyStart = html.indexOf("<body>");
  const bodyEnd = html.lastIndexOf("</body>");
  const body = bodyStart >= 0 && bodyEnd > bodyStart ? html.slice(bodyStart + 6, bodyEnd) : "";

  // 抽掉 title / meta description / canonical / og / twitter / json-ld / feed link
  const cleanedHead = head
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^<title>/i.test(t)) return false;
      if (/name="description"/i.test(t)) return false;
      if (/rel="canonical"/i.test(t)) return false;
      if (/property="og:/i.test(t)) return false;
      if (/name="twitter:/i.test(t)) return false;
      if (/type="application\/ld\+json"/i.test(t)) return false;
      if (/rel="alternate"/i.test(t)) return false;
      if (/rel="icon"/i.test(t)) return false;
      if (/rel="apple-touch-icon"/i.test(t)) return false;
      if (/name="theme-color"/i.test(t)) return false;
      return true;
    })
    .join("\n    ");

  return { cleanedHead, body };
}

/**
 * 生成一个完整页面。
 *
 * 关键：用字符串定位而不是正则来替换 <div id="app"> 的内容。
 * 正则 /<div id="app">[\s\S]*?<\/div>/ 会在第一个 </div> 处停下，
 * 而 app 容器内部本来就含有嵌套 div —— 预渲染内容会被截断。
 */
function buildPage({ shell, headTags, bodyClass = "", prerendered = "", depth = 0 }) {
  const { cleanedHead, body } = shell;

  /*
   * 资源路径修正。
   *
   * 原始页面的资源引用是相对路径（./src/styles/main.css），
   * 放在根目录没问题，但预渲染产物里有子目录（/period/、/project/），
   * 同样的相对路径会解析成 /period/src/... 从而 404。
   *
   * 做法：按层级把 ./ 换成 ../，保持相对路径的语义不变
   * （站点部署在仓库子路径下，用绝对路径会指向错误的根）。
   */
  const prefix = depth > 0 ? "../".repeat(depth) : "";

  const appOpen = '<div id="app">';
  const appIdx = body.indexOf(appOpen);
  let bodyContent = body;

  if (appIdx >= 0) {
    const afterOpen = appIdx + appOpen.length;
    /*
     * 定位 app 容器的结束标签。
     *
     * 不能用 lastIndexOf("</div>")：project.html 的 app 容器是空的
     * （<div id="app"></div>），body 里它后面再没有别的 div，
     * lastIndexOf 会找到它自己的闭合标签，插入位置就错了。
     *
     * 正确做法：从 app 容器起始处做标签配平，找到真正匹配的那个 </div>。
     */
    const closeIdx = findMatchingDivClose(body, afterOpen);
    // closeIdx >= afterOpen：空容器（<div id="app"></div>）的闭合标签
    // 就在 afterOpen 处，此时 closeIdx === afterOpen，用 > 会漏判。
    if (closeIdx >= afterOpen) {
      // 预渲染内容插在 #app 之后（而不是里面）：
      // 客户端 JS 接管时会 clear(#app)，插在内部的内容会一起消失；
      // 放在外部则能持续为「禁用 JS 的用户」和「不渲染 JS 的爬虫」提供内容。
      bodyContent =
        body.slice(0, closeIdx + "</div>".length) +
        "\n    " +
        prerendered +
        body.slice(closeIdx + "</div>".length);
    }
  }

  const bodyTag = bodyClass ? `<body class="${bodyClass}">` : "<body>";

  /*
   * 注入「首帧前移除预渲染块」的内联脚本。
   *
   * 为什么必须内联且放在 head：
   *   - 放外部脚本会因网络延迟而在首帧之后才执行，
   *     用户可能看到预渲染内容与 JS 内容同时出现（闪烁）
   *   - 放 head 里则在样式应用前就完成清理
   *
   * 这段脚本不依赖 lib/ui.js 的模块加载时机，因此更可靠。
   */
  const cleanupScript = `<script>
      // 客户端即将接管，移除构建期预渲染内容，避免重复显示
      (function () {
        var html = document.documentElement;
        html.classList.add("js-ready");
        var blocks = document.querySelectorAll(".prerender-block");
        for (var i = 0; i < blocks.length; i++) blocks[i].remove();
      })();
    </script>`;

  const head = prefix ? cleanedHead.replace(/("\.\/)/g, `"${prefix}`) : cleanedHead;
  const bodyOut = prefix ? bodyContent.replace(/("\.\/)/g, `"${prefix}`) : bodyContent;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
  <head>
    ${head}
    ${cleanupScript}
    ${headTags}
  </head>
  ${bodyTag}${bodyOut}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* Feed 生成                                                           */
/* ------------------------------------------------------------------ */

/** RSS 2.0。 */
function buildRss(snapshot, period) {
  const rows = buildRanking(snapshot, period.id).slice(0, 50);
  const items = rows
    .map((row) => {
      const link = `${SITE_URL}/project/${encodeURIComponent(row.fullName.split("/")[0])}/${encodeURIComponent(row.fullName.split("/").slice(1).join("/"))}.html`;
      const growth = row.periodGrowth == null ? "暂无基线" : `+${formatNumber(row.periodGrowth)}`;
      const desc = [
        row.description || "该项目没有提供描述",
        `| Star 总数 ${formatNumber(row.periodStars)}`,
        `| ${period.label}榜增长 ${growth}`,
        row.language ? `| ${row.language}` : "",
        row.topics?.length ? `| 话题：${row.topics.slice(0, 5).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      // guid 用 permalink：条目 URL 稳定不变，阅读器才不会当成新条目
      return `    <item>
      <title>${esc(row.fullName)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${rfc822(row.pushedAt || snapshot.generatedAt)}</pubDate>
      <category>${esc(row.language || "其他")}</category>
      <description>${esc(desc)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} · ${period.label}榜趋势</title>
    <link>${SITE_URL}/</link>
    <description>开源项目${period.label}榜 Star 增长排行，每 2 小时自动更新。</description>
    <language>zh-cn</language>
    <lastBuildDate>${rfc822(snapshot.generatedAt)}</lastBuildDate>
    <generator>github-trends-site</generator>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${SITE_URL}/favicon.svg</url>
      <title>${esc(SITE_NAME)}</title>
      <link>${SITE_URL}/</link>
    </image>
${items}
  </channel>
</rss>
`;
}

/** Atom 1.0。 */
function buildAtom(snapshot, period) {
  const rows = buildRanking(snapshot, period.id).slice(0, 50);
  const entries = rows
    .map((row) => {
      const link = `${SITE_URL}/project/${encodeURIComponent(row.fullName.split("/")[0])}/${encodeURIComponent(row.fullName.split("/").slice(1).join("/"))}.html`;
      const growth = row.periodGrowth == null ? "暂无基线" : `+${formatNumber(row.periodGrowth)}`;
      const summary = [
        row.description || "该项目没有提供描述",
        `Star 总数 ${formatNumber(row.periodStars)} · ${period.label}榜增长 ${growth}`,
        row.language ? `· ${row.language}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `  <entry>
    <title>${esc(row.fullName)}</title>
    <id>${esc(link)}</id>
    <link rel="alternate" type="text/html" href="${esc(link)}"/>
    <updated>${isoDate(row.pushedAt || snapshot.generatedAt)}</updated>
    <published>${isoDate(row.createdAt || snapshot.generatedAt)}</published>
    <category term="${esc(row.language || "其他")}"/>
    <summary type="text">${esc(summary)}</summary>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${SITE_LANG}">
  <title>${esc(SITE_NAME)} · ${period.label}榜趋势</title>
  <id>${SITE_URL}/</id>
  <link rel="alternate" type="text/html" href="${SITE_URL}/"/>
  <link rel="self" type="application/atom+xml" href="${SITE_URL}/atom.xml"/>
  <updated>${isoDate(snapshot.generatedAt)}</updated>
  <subtitle>开源项目${period.label}榜 Star 增长排行，每 2 小时自动更新。</subtitle>
  <author><name>${esc(SITE_NAME)}</name></author>
  <generator uri="${SITE_URL}/">github-trends-site</generator>
${entries}
</feed>
`;
}

/* ------------------------------------------------------------------ */
/* sitemap / robots                                                     */
/* ------------------------------------------------------------------ */

function buildSitemap(snapshot) {
  const urls = [
    { loc: `${SITE_URL}/`, priority: "1.0", changefreq: "hourly", lastmod: snapshot.generatedAt },
    { loc: `${SITE_URL}/overview.html`, priority: "0.9", changefreq: "hourly", lastmod: snapshot.generatedAt },
    { loc: `${SITE_URL}/favorites.html`, priority: "0.4", changefreq: "weekly", lastmod: snapshot.generatedAt },
    { loc: `${SITE_URL}/compare.html`, priority: "0.5", changefreq: "weekly", lastmod: snapshot.generatedAt },
  ];

  // 各周期榜单的静态入口
  for (const period of PERIODS) {
    urls.push({
      loc: `${SITE_URL}/period/${period.id}.html`,
      priority: "0.8",
      changefreq: "hourly",
      lastmod: snapshot.generatedAt,
    });
  }

  // 在榜项目详情页
  for (const repo of snapshot.items) {
    urls.push({
      loc: `${SITE_URL}/project/${encodeURIComponent(repo.fullName.split("/")[0])}/${encodeURIComponent(repo.fullName.split("/").slice(1).join("/"))}.html`,
      priority: "0.6",
      changefreq: "daily",
      lastmod: repo.pushedAt || snapshot.generatedAt,
    });
  }

  const body = urls
    .map(
      (u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    <lastmod>${isoDate(u.lastmod)}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function buildRobots() {
  return `# 开源趋势站 — robots.txt
#
# 允许抓取全部公开内容。客户端渲染的页面已在构建期预渲染（SSG），
# 爬虫无需执行 JavaScript 即可读到完整榜单内容。
User-agent: *
Allow: /

# 无实际搜索结果的页面不进入索引
# （GitHub Pages 的 404.html 由服务器在 404 状态下返回，无需 Disallow）
Disallow: /nojs-preview.html

# 抓取频率提示（多数爬虫会忽略，但礼貌起见）
Crawl-delay: 1

# 站点地图
Sitemap: ${SITE_URL}/sitemap.xml
`;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(SNAPSHOT, "utf8"));
  } catch {
    console.error("✗ 找不到数据快照 public/data/trending.json，跳过预渲染。");
    console.error("  先运行：node scripts/fetch-trending.mjs --once");
    process.exit(0);
  }

  if (!Array.isArray(snapshot.items) || !snapshot.items.length) {
    console.error("✗ 快照无有效条目，跳过预渲染。");
    process.exit(0);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const totals = summarize(snapshot);
  const written = [];

  // 原始页面 shell（head 公共部分 + body 结构）只读一次
  const shells = {
    index: extractShell(await readFile(resolve(ROOT, "index.html"), "utf8")),
    overview: extractShell(await readFile(resolve(ROOT, "overview.html"), "utf8")),
    project: extractShell(await readFile(resolve(ROOT, "project.html"), "utf8")),
    favorites: extractShell(await readFile(resolve(ROOT, "favorites.html"), "utf8")),
    compare: extractShell(await readFile(resolve(ROOT, "compare.html"), "utf8")),
    notFound: extractShell(await readFile(resolve(ROOT, "404.html"), "utf8")),
  };

  /* ---- 各周期静态页 ---- */
  for (const period of PERIODS) {
    const rows = buildRanking(snapshot, period.id);
    const stat = totals[period.id];
    const top = stat.top;

    const title = `开源项目${period.label}榜趋势 · GitHub Star 增长 Top ${rows.length} | ${SITE_NAME}`;
    const description = `按${period.label}榜 Star 增长量排序的开源项目榜单，共 ${formatNumber(stat.count)} 个在榜项目，本期新增 Star 合计 ${formatNumber(stat.growth)}。${top ? `榜首 ${top.fullName}。` : ""}数据每 2 小时自动更新。`;

    const headTags = buildHeadTags({
      title,
      description,
      canonical: `${SITE_URL}/period/${period.id}.html`,
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [websiteJsonLd(snapshot), itemListJsonLd(rows, period)],
      },
    });

    const final = buildPage({
      shell: shells.index,
      headTags,
      prerendered: renderPrerenderedContent(snapshot, period),
      depth: 1,
    });

    const file = resolve(OUT_DIR, `period/${period.id}.html`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, final, "utf8");
    written.push(`period/${period.id}.html`);
  }

  /* ---- 首页（含完整榜单）---- */
  {
    const week = PERIODS[0];
    const rows = buildRanking(snapshot, week.id);
    const stat = totals[week.id];
    const top = stat.top;

    const title = `开源项目趋势榜单 · GitHub Trending 统计 | ${SITE_NAME}`;
    const description = `基于 GitHub REST API 的开源项目周期热度统计：周榜 / 月榜 / 季度 / 半年 / 年度，含 Star 增长量、语言分布与项目对比。当前周榜 ${formatNumber(stat.count)} 个项目，榜首 ${top ? top.fullName : "—"}。`;

    const headTags = buildHeadTags({
      title,
      description,
      canonical: `${SITE_URL}/`,
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [websiteJsonLd(snapshot), itemListJsonLd(rows, week)],
      },
    });

    const final = buildPage({
      shell: shells.index,
      headTags,
      prerendered: renderPrerenderedContent(snapshot, week),
    });
    await writeFile(resolve(OUT_DIR, "index.html"), final, "utf8");
    written.push("index.html");
  }

  /* ---- 总览页 ---- */
  {
    const headTags = buildHeadTags({
      title: `总览面板 · 各周期热度统计 | ${SITE_NAME}`,
      description: `汇总周榜、月榜、季度、半年、年度各周期的在榜项目数、Star 增长总量与语言分布。数据每 2 小时自动更新。`,
      canonical: `${SITE_URL}/overview.html`,
      jsonLd: websiteJsonLd(snapshot),
    });

    /*
     * 总览页预渲染：各周期的汇总数字。
     *
     * 这个页面是纯仪表盘，交互部分（图表、缓存状态）都在客户端生成，
     * 但「各周期有多少项目、增长多少」这些核心数字完全可以静态化 ——
     * 搜索引擎能读到这些数字，页面在索引里才有实质内容。
     */
    const overviewRows = PERIODS.map((p) => {
      const stat = totals[p.id];
      const top = stat.top;
      return `        <tr>
          <td>${p.label}</td>
          <td class="num">${formatNumber(stat.count)}</td>
          <td class="num">${formatNumber(stat.growth)}</td>
          <td>${esc(top ? top.fullName : "—")}</td>
        </tr>`;
    }).join("\n");

    const distribution = languageDistribution(snapshot, PERIODS[0].id);
    const langRows = distribution
      .map(
        (item) => `        <li>${esc(item.language)} —— ${item.count} 个在榜项目（占 ${(item.ratio * 100).toFixed(1)}%）</li>`,
      )
      .join("\n");

    const prerendered = `
    <div class="prerender-block" id="prerendered">
      <div class="prerender-inner">
        <section class="page-head">
          <div>
            <h1 class="page-title">各周期热度总览</h1>
            <p class="page-sub">周榜、月榜、季度、半年、年度五个周期的在榜项目数与 Star 增长总量汇总，数据每 2 小时自动更新。</p>
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">各周期统计</h2>
          <table class="mini-table">
            <thead><tr><th>周期</th><th>在榜项目数</th><th>Star 增长合计</th><th>榜首项目</th></tr></thead>
            <tbody>
${overviewRows}
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2 class="card__title">周榜主要语言分布</h2>
          <ul class="note-list">
${langRows}
          </ul>
        </section>

        <section class="card">
          <h2 class="card__title">数据说明</h2>
          <ul class="note-list">
            <li>Star 增长量 = 该周期窗口内每日增长量之和，由 Actions 逐日累积快照得出。</li>
            <li>在榜判定基于 pushed 时间窗口，捕捉老项目的新版本爆发，而非只看新建仓库。</li>
            <li>当前快照生成于 ${esc(isoDate(snapshot.generatedAt))}，共 ${formatNumber(snapshot.items.length)} 个在榜项目。</li>
          </ul>
        </section>
      </div>
    </div>`;

    const final = buildPage({ shell: shells.overview, headTags, prerendered });
    await writeFile(resolve(OUT_DIR, "overview.html"), final, "utf8");
    written.push("overview.html");
  }

  /* ---- 项目详情页（为快照内每个项目生成一份静态页）---- */
  {
    const shell = shells.project;
    const week = PERIODS[0];
    const dir = resolve(OUT_DIR, "project");
    await mkdir(dir, { recursive: true });

    for (const repo of snapshot.items) {
      const title = `${repo.fullName} · ${repo.description ? repo.description.slice(0, 60) : "开源项目"} | ${SITE_NAME}`;
      const description = `${repo.fullName}：${repo.description || "开源项目"}。Star ${formatNumber(repo.stars)}，Fork ${formatNumber(repo.forks)}，主要语言 ${repo.language || "未知"}。${
        repo.growth?.week != null ? `周榜 Star 增长 +${formatNumber(repo.growth.week)}。` : ""
      }`;

      const headTags = buildHeadTags({
        title,
        description,
        canonical: `${SITE_URL}/project/${encodeURIComponent(repo.fullName.split("/")[0])}/${encodeURIComponent(repo.fullName.split("/").slice(1).join("/"))}.html`,
        ogType: "article",
        jsonLd: {
          "@context": "https://schema.org",
          "@graph": [
            softwareJsonLd(repo, week),
            breadcrumbJsonLd([
              { name: "趋势榜单", url: `${SITE_URL}/` },
              { name: repo.fullName, url: `${SITE_URL}/project/${encodeURIComponent(repo.fullName.split("/")[0])}/${encodeURIComponent(repo.fullName.split("/").slice(1).join("/"))}.html` },
            ]),
          ],
        },
      });

      // 详情页的静态快照：项目元信息 + 各周期成绩
      const ranks = {};
      for (const p of PERIODS) {
        const idx = buildRanking(snapshot, p.id).findIndex((r) => r.fullName === repo.fullName);
        ranks[p.id] = idx >= 0 ? idx + 1 : null;
      }
      const prerendered = `
    <div class="prerender-block" id="prerendered">
      <div class="prerender-inner">
        <section class="repo-head">
          <div class="repo-head__main">
            <div class="repo-head__text">
              <h1 class="page-title page-title--repo">${esc(repo.fullName)}</h1>
              <p class="page-sub">${esc(repo.description || "该项目没有提供描述")}</p>
            </div>
          </div>
          <dl class="repo-meta">
            <div class="repo-meta__item"><dt class="repo-meta__label">周榜排名</dt><dd class="repo-meta__value is-strong">${ranks.week ? `No.${ranks.week}` : "未在榜"}</dd></div>
            <div class="repo-meta__item"><dt class="repo-meta__label">主要语言</dt><dd class="repo-meta__value">${esc(repo.language || "—")}</dd></div>
            <div class="repo-meta__item"><dt class="repo-meta__label">许可证</dt><dd class="repo-meta__value">${esc(repo.license || "—")}</dd></div>
            <div class="repo-meta__item"><dt class="repo-meta__label">创建时间</dt><dd class="repo-meta__value num">${esc(String(repo.createdAt || "—").slice(0, 10))}</dd></div>
          </dl>
        </section>
        <section class="kpi-row kpi-row--5">
          <div class="kpi kpi--primary"><span class="kpi__label">Star 总数</span><span class="kpi__value num">${formatNumber(repo.stars)}</span></div>
          <div class="kpi"><span class="kpi__label">周榜 Star 增长</span><span class="kpi__value num">${repo.growth?.week != null ? `+${formatNumber(repo.growth.week)}` : "暂无基线"}</span></div>
          <div class="kpi"><span class="kpi__label">Fork 数</span><span class="kpi__value num">${formatNumber(repo.forks)}</span></div>
          <div class="kpi"><span class="kpi__label">开放 Issue</span><span class="kpi__value num">${formatNumber(repo.openIssues)}</span></div>
          <div class="kpi"><span class="kpi__label">话题数</span><span class="kpi__value num">${formatNumber((repo.topics || []).length)}</span></div>
        </section>
        <section class="card">
          <h2 class="card__title">各周期榜单成绩</h2>
          <table class="mini-table">
            <thead><tr><th>周期</th><th>排名</th><th>Star 总数</th><th>周期增长</th></tr></thead>
            <tbody>
${PERIODS.map((p) => {
  const st = repo.periods?.[p.id];
  if (st == null) return "";
  const g = repo.growth?.[p.id];
  return `              <tr><td class="is-current">本${p.label}</td><td class="${ranks[p.id] ? "num" : "cell-muted"}">${ranks[p.id] ? `No.${ranks[p.id]}` : "—"}</td><td class="num">${formatNumber(st)}</td><td class="${g == null ? "cell-muted" : "num"}">${g == null ? "暂无基线" : `+${formatNumber(g)}`}</td></tr>`;
}).join("\n")}
            </tbody>
          </table>
        </section>
        <section class="card">
          <h2 class="card__title">相关链接</h2>
          <ul class="note-list">
            <li><a href="${SITE_URL}/">返回趋势总览</a></li>
            <li><a href="${SITE_URL}/period/week.html">周榜完整榜单</a> · <a href="${SITE_URL}/period/month.html">月榜</a> · <a href="${SITE_URL}/period/quarter.html">季度榜</a> · <a href="${SITE_URL}/period/half.html">半年榜</a> · <a href="${SITE_URL}/period/year.html">年度榜</a></li>
            <li><a href="${repo.url}" target="_blank" rel="noopener noreferrer">在 GitHub 上查看 ${esc(repo.fullName)}</a></li>
            <li><a href="${SITE_URL}/compare.html">把多个项目放在一起对比</a></li>
          </ul>
        </section>
      </div>
    </div>`;

      // depth=2：路径是 /project/owner/repo.html，两层目录
      const final = buildPage({ shell, headTags, prerendered, depth: 2 });
      // 路径形式：project/owner/repo.html —— 比 ?full_name= 查询参数更利于收录
      const owner = repo.fullName.split("/")[0] || "unknown";
      const name = repo.fullName.split("/").slice(1).join("/") || "repo";
      const dir2 = resolve(dir, owner);
      await mkdir(dir2, { recursive: true });
      await writeFile(resolve(dir2, `${name}.html`), final, "utf8");
    }
    written.push(`project/ (${snapshot.items.length} 个详情页)`);
  }

  /* ---- 旧 URL 兼容入口 ----
   *
   * 早期版本的详情页是 project.html?full_name=owner/repo。
   * 这些链接可能已被分享出去，不能直接失效（404 对 SEO 也不友好）。
   *
   * 这里保留 project.html，并让它在客户端把查询参数转成新路径重定向。
   * 同时给它一个 canonical 指向站点首页，避免搜索引擎把它当成独立页面收录。
   */
  {
    const headTags = buildHeadTags({
      title: `项目详情 · ${SITE_NAME}`,
      description: "开源项目详情页。",
      canonical: `${SITE_URL}/`,
      jsonLd: websiteJsonLd(snapshot),
    });

    const redirectScript = `<script>
      // 旧地址 → 新地址：project.html?full_name=owner/repo
      //              → /project/owner/repo.html
      (function () {
        var q = new URLSearchParams(window.location.search).get("full_name");
        if (!q) return;
        var parts = q.split("/");
        if (parts.length < 2) return;
        var owner = parts[0];
        var name = parts.slice(1).join("/");
        window.location.replace("./project/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) + ".html");
      })();
    </script>`;

    const final = buildPage({ shell: shells.project, headTags }).replace(
      "</head>",
      `    ${redirectScript}\n  </head>`,
    );
    await writeFile(resolve(OUT_DIR, "project.html"), final, "utf8");
    written.push("project.html (旧地址兼容入口)");
  }

  /* ---- 收藏 / 对比页 ---- */
  for (const [file, title, description] of [
    ["favorites.html", `我的收藏 · ${SITE_NAME}`, "收藏的开源项目列表，保存在浏览器本地不上传服务器，可查看每个项目的 Star 增长、榜单排名与热度变化。"],
    ["compare.html", `项目对比 · ${SITE_NAME}`, "并排对比多个开源项目的 Star 增长、榜单排名与主要语言分布，最多同时对比 4 个项目，数据来自 GitHub REST API。"],
  ]) {
    const shell = file === "favorites.html" ? shells.favorites : shells.compare;
    const headTags = buildHeadTags({
      title,
      description,
      canonical: `${SITE_URL}/${file}`,
      jsonLd: websiteJsonLd(snapshot),
    });

    /*
     * 收藏/对比页也做预渲染。
     *
     * 它们的交互性很强（收藏存在 localStorage、对比是可编辑的清单），
     * 但页面本身仍需要：
     *   - 一个 h1（搜索引擎用它确定页面主题，缺失会降低相关性）
     *   - 足够的静态文本说明这个页面是干什么的
     * 否则爬虫看到的只有一个空容器，页面在索引里没有任何描述。
     */
    const isFavorites = file === "favorites.html";
    const prerendered = `
    <div class="prerender-block" id="prerendered">
      <div class="prerender-inner">
        <section class="page-head">
          <div>
            <h1 class="page-title">${isFavorites ? "我的收藏" : "项目对比"}</h1>
            <p class="page-sub">${isFavorites
              ? "收藏的开源项目列表，保存在浏览器本地，不上传服务器。可查看每个项目的 Star 增长与榜单排名。"
              : "并排对比多个开源项目的 Star 增长、榜单排名与主要语言，最多同时对比 4 个项目。"}</p>
          </div>
        </section>
        <section class="card">
          <h2 class="card__title">${isFavorites ? "关于收藏" : "关于对比"}</h2>
          <ul class="note-list">
            <li>${isFavorites
              ? "在榜单页点击星标即可加入收藏，数据存于浏览器 localStorage，换设备不会同步。"
              : "在榜单页点击「加入对比」把项目加入清单，然后从顶栏进入本页查看并排对比。"}</li>
            <li>当前快照生成于 ${esc(isoDate(snapshot.generatedAt))}，全站共 ${formatNumber(snapshot.items.length)} 个在榜项目。</li>
            <li>对比清单最多保留 ${4} 个项目，超出时请先移除。</li>
            <li>本站数据来自 GitHub REST API，由 GitHub Actions 每 2 小时自动抓取。</li>
          </ul>
        </section>
      </div>
    </div>`;

    const final = buildPage({ shell, headTags, prerendered });
    await writeFile(resolve(OUT_DIR, file), final, "utf8");
    written.push(file);
  }

  /* ---- 404 ---- */
  {
    const shell = shells.notFound;
    const headTags = buildHeadTags({
      title: `页面不存在 | ${SITE_NAME}`,
      description: "请求的页面不存在。",
      canonical: `${SITE_URL}/404.html`,
    });
    const final = buildPage({ shell, headTags });
    await writeFile(resolve(OUT_DIR, "404.html"), final, "utf8");
    written.push("404.html");
  }

  /* ---- Feed ---- */
  const week = PERIODS[0];
  await writeFile(resolve(OUT_DIR, "feed.xml"), buildRss(snapshot, week), "utf8");
  await writeFile(resolve(OUT_DIR, "atom.xml"), buildAtom(snapshot, week), "utf8");
  written.push("feed.xml", "atom.xml");

  /* ---- sitemap / robots ---- */
  await writeFile(resolve(OUT_DIR, "sitemap.xml"), buildSitemap(snapshot), "utf8");
  await writeFile(resolve(OUT_DIR, "robots.txt"), buildRobots(), "utf8");
  written.push("sitemap.xml", "robots.txt");

  /* ---- favicon ---- */
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#1c2024"/>
  <path d="M6 22l6-6 4 4 10-10" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="26" cy="10" r="2.6" fill="#ffffff"/>
</svg>
`;
  await writeFile(resolve(OUT_DIR, "favicon.svg"), favicon, "utf8");
  written.push("favicon.svg");

  /* ---- manifest ---- */
  const manifest = {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: "开源项目周期热度统计",
    start_url: `${SITE_URL}/`,
    display: "standalone",
    background_color: "#fcfcfd",
    theme_color: "#3e63dd",
    icons: [{ src: `${SITE_URL}/favicon.svg`, sizes: "any", type: "image/svg+xml" }],
  };
  await writeFile(resolve(OUT_DIR, "manifest.webmanifest"), JSON.stringify(manifest, null, 2), "utf8");
  written.push("manifest.webmanifest");

  console.log("✓ 预渲染完成");
  console.log(`  快照时间：${snapshot.generatedAt}`);
  console.log(`  产出：${written.length} 项`);
  for (const w of written) console.log(`    · ${w}`);
}

main().catch((err) => {
  console.error("✗ 预渲染失败：", err);
  process.exit(1);
});
