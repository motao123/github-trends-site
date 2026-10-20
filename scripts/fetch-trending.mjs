#!/usr/bin/env node
/**
 * 抓取脚本 —— 本站规避速率限制的核心。
 *
 * 用法：
 *   GH_PAT=ghp_xxx node scripts/fetch-trending.mjs            # 带令牌，推荐
 *   node scripts/fetch-trending.mjs                             # 匿名，仅本地调试
 *   node scripts/fetch-trending.mjs --once                      # 抓一次后退出（本地用）
 *
 * 工作流程：
 *   1. 读取上一次快照 public/data/trending.json（若存在）
 *   2. 按 5 个周期各调用一次 search/repositories，取窗口内 Star 最高的 100 个仓库
 *   3. 用上一次的 star 值做差，得到真实的 star 增长量
 *   4. 把新快照写入 public/data/trending.json，并累计每日增长历史（供趋势图使用）
 *   5. 把当天的日增长追加进 history，保留最近 400 天
 *
 * 不引入任何依赖，Node 18+ 直接运行。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "public/data");
const SNAPSHOT = resolve(DATA_DIR, "trending.json");
const HISTORY_DAYS = 400;

const PERIODS = [
  { id: "week", days: 7 },
  { id: "month", days: 30 },
  { id: "quarter", days: 90 },
  { id: "half", days: 180 },
  { id: "year", days: 365 },
];

/**
 * 令牌解析。GitHub Actions 的 Secret 不能叫 GITHUB_TOKEN（平台会返回
 * HTTP 422：Secret names must not start with GITHUB_），因此统一用 GH_PAT。
 * 这里保留多个候选名，兼容不同的 CI 配置习惯。
 */
function resolveToken() {
  const candidates = [
    process.env.GH_PAT,
    process.env.GITHUB_PAT,
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
  ];
  const token = candidates.find((t) => t && t.trim());
  return token ? token.trim() : "";
}

const TOKEN = resolveToken();
const DRY_ONCE = process.argv.includes("--once");

/* ---------------- 工具 ---------------- */

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 时间戳 → YYYY-MM-DD（UTC，与 today() 保持同一时区口径）。 */
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

async function api(path, { retries = 3 } = {}) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github-trends-site",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, { headers });

    if (res.status === 403 || res.status === 429) {
      const remaining = Number(res.headers.get("X-RateLimit-Remaining") || "0");
      const reset = Number(res.headers.get("X-RateLimit-Reset") || "0") * 1000;
      if (remaining === 0) {
        const waitSec = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
        throw new Error(
          `速率限制已用尽（${TOKEN ? "已配置令牌仍受限" : "建议配置 GH_PAT"}），配额将于 ${new Date(reset).toISOString()} 重置`
        );
      }
      if (waitSec >= 0 && res.headers.get("X-RateLimit-Remaining") === "0") {
        throw new Error("速率限制已用尽");
      }
    }

    if (res.status === 422) {
      // search 接口在 10 次/分钟未认证时有概率触发，等 60s 重试
      if (attempt < retries) {
        console.warn("  · 触发二级速率限制，等待 60s 后重试…");
        await sleep(60000);
        continue;
      }
      throw new Error("search 接口返回 422，通常是查询过于频繁或分页越界");
    }

    if (!res.ok) {
      const body = await res.text();
      if (attempt < retries) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    // search 接口有独立配额，做一次节流避免连锁触发 422
    await sleep(2500);
    return data;
  }
  throw new Error("请求失败，已达最大重试次数");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- 主流程 ---------------- */

async function readPrevious() {
  try {
    const raw = await readFile(SNAPSHOT, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) return parsed;
  } catch {
    /* 首次运行没有快照 */
  }
  return null;
}

function normalize(item) {
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
  };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log("▸ GitHub 开源趋势抓取开始");
  console.log(`  认证方式：${TOKEN ? "已配置令牌（GH_PAT）" : "匿名（60 次/小时，建议配置令牌）"}`);

  const previous = await readPrevious();
  if (previous) {
    console.log(`  上一次快照：${previous.generatedAt}`);
  } else {
    console.log("  上一次快照：无（首次运行，增长量将标记为暂无基线）");
  }

  const repos = new Map();

  for (const period of PERIODS) {
    const since = isoDaysAgo(period.days);
    const params = new URLSearchParams({
      sort: "stars",
      order: "desc",
      per_page: "100",
      q: `pushed:>=${since} stars:>100`,
    });
    console.log(`  · 抓取 ${period.id}（pushed >= ${since}）…`);
    const data = await api(`/search/repositories?${params.toString()}`);

    for (const item of data.items || []) {
      if (!repos.has(item.full_name)) {
        repos.set(item.full_name, { ...normalize(item), periods: {}, growth: {}, covered: {} });
      }
      repos.get(item.full_name).periods[period.id] = item.stargazers_count;
    }
    console.log(`    返回 ${data.items?.length || 0} 个，累计 ${repos.size} 个项目`);
  }

  /* ---- 计算增长量 ---- */
  const prevStars = new Map();
  if (previous) {
    for (const item of previous.items) prevStars.set(item.fullName, item.stars);
  }

  const history = previous?.history || {};
  const items = [...repos.values()];
  let withGrowth = 0;

  /* ---- 先算每日的 star 增量，追加进 history ---- */
  const day = today();
  for (const item of items) {
    const base = prevStars.get(item.fullName);
    if (base == null) continue;
    // 日增量用 stars（抓取时的实时总量）做差，与任何周期窗口无关 ——
    // 这样 history 里的每一天都是「该日真实新增」，各周期再从它派生。
    const delta = item.stars - base;
    if (delta <= 0) continue;

    if (!history[item.fullName]) history[item.fullName] = [];
    const list = history[item.fullName];
    const existing = list.find((point) => point.date === day);
    // 同一天会被抓取多次（每 2 小时一次），必须累加而不是覆盖 ——
    // 覆盖会让当天的值变成「最近一次 2 小时的增量」，
    // 日增量之和就不再等于当天的真实增长。
    if (existing) existing.delta += delta;
    else list.push({ date: day, delta });
    if (list.length > HISTORY_DAYS) list.splice(0, list.length - HISTORY_DAYS);
  }

  /* ---- 周期增长 = 该周期窗口内 history 的日增量之和 ----
   *
   * 为什么不用「相邻两次快照做差」：
   *   相邻快照只隔 2 小时，做差得到的是「2 小时增量」，
   *   五个周期算出来几乎是同一个数（实测 1347/1351/1353/1354/1354），
   *   周期长度这个最关键的信息完全丢失。
   *
   * 正确口径：周期增长 = 该窗口内每天的增长量累加。
   *
   * 关于基线不足：站点刚部署时历史只有一两天，此时给出「暂无基线」是对的，
   * 但如果一律置 null，五个周期全空，用户什么都看不到。
   * 因此这里采用「有数据就给数、同时记录覆盖天数」的方式：
   *   growth  = 窗口内日增量之和
   *   covered = 该值实际覆盖了几天
   * 前端据此提示「已积累 N 天」，读者能判断这个数代表多长的区间。
   */
  for (const item of items) {
    for (const period of PERIODS) {
      const current = item.periods[period.id];
      if (current == null) {
        item.growth[period.id] = null;
        item.covered[period.id] = 0;
        continue;
      }

      const list = history[item.fullName] || [];
      if (list.length === 0) {
        item.growth[period.id] = null;
        item.covered[period.id] = 0;
        continue;
      }

      const cutoff = dayKey(Date.now() - period.days * 86400000);
      const inWindow = list.filter((p) => p.date >= cutoff);
      // covered = 窗口内实际积累了多少天的日增量（数据点数量），
      // 而不是日期跨度 —— 10-19 与 10-20 两个数据点代表 2 天有效数据。
      const covered = inWindow.length;

      if (covered === 0) {
        item.growth[period.id] = null;
        item.covered[period.id] = 0;
        continue;
      }

      const sum = inWindow.reduce((acc, p) => acc + (p.delta || 0), 0);
      item.growth[period.id] = sum;
      item.covered[period.id] = covered;
      if (sum > 0) withGrowth += 1;
    }
  }

  /* ---- 写快照 ---- */
  const snapshot = {
    version: 1,
    source: "actions",
    generatedAt: new Date().toISOString(),
    baselineAt: previous?.generatedAt || null,
    periodCount: items.length,
    items,
    history,
  };

  await writeFile(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log("▸ 完成");
  console.log(`  项目数：${items.length}`);
  console.log(`  有增长数据的条目：${withGrowth}`);
  console.log(`  基线时间：${snapshot.baselineAt || "无（下次运行起可计算增长）"}`);
  console.log(`  写入：${SNAPSHOT}`);

  if (DRY_ONCE) {
    console.log("  --once 模式：已退出，不进入轮询。");
  }
}

main().catch((err) => {
  console.error("✗ 抓取失败：", err.message);
  process.exitCode = 1;
});
