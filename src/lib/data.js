/**
 * 周期、缓存与数据整形。
 *
 * Star 增长量的计算方式（本项目的核心口径）：
 *   growth = 当前快照 star 数 - N 天前的快照 star 数
 * GitHub 的 search 接口不提供历史值，所以必须靠本地快照累积：
 *   - 定时任务每 2 小时写一次 data/trending.json
 *   - 每次写入时用上一次的 star_count 做差，得到真实的增长量
 *   - 没有历史快照时（首次部署）growth 为 null，界面显示「暂无基线」而不是 0
 */

import { fetchTrendingRepos } from "./github-api.js";

/** 周期定义：窗口天数 + 展示名。 */
export const PERIODS = [
  { id: "week", label: "周榜", days: 7 },
  { id: "month", label: "月榜", days: 30 },
  { id: "quarter", label: "季度", days: 90 },
  { id: "half", label: "半年", days: 180 },
  { id: "year", label: "年度", days: 365 },
];

export const PERIOD_MAP = new Map(PERIODS.map((p) => [p.id, p]));

/**
 * 静态快照候选路径。
 * 站点是纯静态多页结构，快照放在仓库的 public/data/ 下；Pages 以仓库根为站点根，
 * 因此线上路径为 /public/data/trending.json。本地开发服务器的 public 映射也能命中。
 * 保留多个候选是为了兼容「把 public 目录当站点根」的其他部署方式。
 */
const SNAPSHOT_PATHS = ["public/data/trending.json", "data/trending.json"];
const CACHE_KEY = "gh_trends_snapshot_v1";
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 小时，与 Actions 频率对齐

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ---------------- 本地缓存（localStorage） ---------------- */

export function readLocalCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalCache(payload) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* 配额超限时静默失败，退回内存态 */
  }
}

export function clearLocalCache() {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function isFresh(snapshot) {
  if (!snapshot || !snapshot.generatedAt) return false;
  return Date.now() - new Date(snapshot.generatedAt).getTime() < CACHE_TTL;
}

/* ---------------- 快照加载 ---------------- */

/**
 * 加载数据源。优先级：
 *   1. 内存 / localStorage 中的新鲜快照
 *   2. 仓库里的静态快照 data/trending.json（Actions 构建产物）
 *   3. 浏览器直连 GitHub API
 *
 * @param {{force?: boolean, signal?: AbortSignal}} options
 * @returns {Promise<{source: string, snapshot: object}>}
 */
export async function loadSnapshot({ force = false, signal } = {}) {
  if (!force) {
    const local = readLocalCache();
    if (isFresh(local)) {
      return { source: "local", snapshot: local };
    }
  }

  // 静态快照：随站点一起部署，不消耗任何用户侧的 API 额度。
  for (const path of SNAPSHOT_PATHS) {
    try {
      const res = await fetch(path, { signal, cache: "no-cache" });
      if (!res.ok) continue;
      const snapshot = await res.json();
      if (snapshot && Array.isArray(snapshot.items) && snapshot.items.length > 0) {
        writeLocalCache(snapshot);
        return { source: "static", snapshot };
      }
      // 快照存在但为空：视为「尚未抓取」，继续走直连
    } catch {
      /* 该候选路径不可用，试下一个 */
    }
  }

  const snapshot = await buildLiveSnapshot(signal);
  writeLocalCache(snapshot);
  return { source: "live", snapshot };
}

/** 直连 API 现算一份快照（本地开发或快照缺失时的兜底）。 */
async function buildLiveSnapshot(signal) {
  const repos = new Map();

  for (const period of PERIODS) {
    const since = isoDaysAgo(period.days);
    const { items, rateLimit } = await fetchTrendingRepos({ since, perPage: 100 });
    if (signal?.aborted) break;

    for (const item of items) {
      const existing = repos.get(item.full_name);
      if (!existing) {
        repos.set(item.full_name, normalizeRepo(item, rateLimit));
      }
      existing.periods[period.id] = item.stargazers_count;
    }
  }

  const items = [...repos.values()];
  // 直连场景没有历史基线，标记为 null 以便界面区分「无数据」和「零增长」。
  for (const item of items) {
    for (const period of PERIODS) {
      const current = item.periods[period.id];
      item.growth[period.id] = current == null ? null : null;
    }
  }

  return {
    version: 1,
    source: "live",
    generatedAt: new Date().toISOString(),
    baselineAt: null,
    items,
  };
}

/** 把 GitHub API 原始对象压成本站使用的最小字段集。 */
export function normalizeRepo(item, rateLimit) {
  return {
    id: item.id,
    fullName: item.full_name,
    owner: item.owner?.login || "",
    name: item.name,
    description: item.description || "",
    language: item.language || "—",
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    watchers: item.watchers_count || 0,
    openIssues: item.open_issues_count || 0,
    topics: item.topics || [],
    license: item.license?.spdx_id || "—",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    pushedAt: item.pushed_at,
    url: item.html_url,
    homepage: item.homepage || "",
    periods: {},
    growth: {},
    rateLimit,
  };
}

/* ---------------- 派生统计 ---------------- */

/** 计算某个周期下的榜单（含筛选与排序）。 */
export function buildRanking(snapshot, periodId, options = {}) {
  const { language = "", topics = [], keyword = "", sort = "growth", direction = "desc" } = options;
  const period = PERIOD_MAP.get(periodId);
  if (!period) return [];

  let rows = snapshot.items
    .map((repo) => ({
      ...repo,
      periodStars: repo.periods?.[periodId] ?? null,
      periodGrowth: repo.growth?.[periodId] ?? null,
    }))
    .filter((repo) => repo.periodStars != null);

  if (language) rows = rows.filter((r) => r.language === language);
  if (topics.length) rows = rows.filter((r) => topics.every((t) => r.topics?.includes(t)));
  if (keyword) {
    const kw = keyword.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(kw) ||
        (r.description || "").toLowerCase().includes(kw) ||
        (r.topics || []).some((t) => t.toLowerCase().includes(kw)),
    );
  }

  const collator = new Intl.Collator("en");

  // 「暂无基线」= null，必须排在所有真实数值之后（无论升降序），
  // 否则降序时会被当成 0 混在中间，读者会误以为这些项目是零增长。
  const nullRank = (v) => (v == null ? 1 : 0);

  rows.sort((a, b) => {
    const na = nullRank(a.periodGrowth);
    const nb = nullRank(b.periodGrowth);
    if (na !== nb) return na - nb;

    let cmp = 0;
    switch (sort) {
      case "stars":
        cmp = a.stars - b.stars;
        break;
      case "growth":
        cmp = (a.periodGrowth ?? 0) - (b.periodGrowth ?? 0);
        break;
      case "forks":
        cmp = a.forks - b.forks;
        break;
      case "updated":
        cmp = new Date(a.pushedAt) - new Date(b.pushedAt);
        break;
      case "created":
        cmp = new Date(a.createdAt) - new Date(b.createdAt);
        break;
      default:
        cmp = (a.periodGrowth ?? 0) - (b.periodGrowth ?? 0);
    }
    if (cmp === 0) cmp = collator.compare(a.fullName, b.fullName);
    return direction === "asc" ? -cmp : cmp;
  });

  return rows;
}

/** 汇总总览面板所需的各周期统计。 */
export function summarize(snapshot) {
  const totals = {};
  for (const period of PERIODS) {
    const rows = buildRanking(snapshot, period.id, { sort: "growth" });
    const growthSum = rows.reduce((acc, r) => acc + (r.periodGrowth ?? 0), 0);
    totals[period.id] = {
      label: period.label,
      count: rows.length,
      growth: growthSum,
      top: rows[0] || null,
    };
  }
  return totals;
}

/** 语言分布（按在榜项目数降序，取前 8）。 */
export function languageDistribution(snapshot, periodId) {
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

/** 从快照里挑出所有出现过的语言，供筛选下拉使用。 */
export function allLanguages(snapshot) {
  const set = new Set();
  for (const item of snapshot.items) {
    if (item.language) set.add(item.language);
  }
  return [...set].sort();
}

/** 从快照里挑出高频话题标签。 */
export function allTopics(snapshot, limit = 12) {
  const counter = new Map();
  for (const item of snapshot.items) {
    for (const topic of item.topics || []) {
      counter.set(topic, (counter.get(topic) || 0) + 1);
    }
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic, count]) => ({ topic, count }));
}

/** 供界面展示的缓存新鲜度文案。 */
export function freshnessLabel(generatedAt) {
  if (!generatedAt) return "未知";
  const diff = Date.now() - new Date(generatedAt).getTime();
  if (diff < 0) return "刚刚";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 模拟人类可读的更新时间（仅取 HH:MM:SS）。 */
export function clockLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}
