/**
 * GitHub API 客户端。
 *
 * 设计要点：
 * 1. 双通道取数 —— 优先读构建期由 GitHub Actions 落盘的静态快照（data/trending.json），
 *    缺失或过期时回退到浏览器直连 api.github.com。
 * 2. 静态快照是本站规避速率限制的主要手段：匿名直连只有 60 次/小时，
 *    而 Actions 里带 PAT 的定时任务是 5000 次/小时。
 * 3. 所有请求都带超时，避免页面卡在骨架屏。
 */

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT = 12000;

/** 匿名请求的速率上限，用于提示文案。 */
export const RATE_LIMIT_ANONYMOUS = 60;

let cachedToken = null;

/**
 * 读取运行时令牌。
 * 注意：静态站点无法安全保存 PAT —— 任何写进前端代码的令牌都是公开的。
 * 这里仅支持本地开发调试用，正式部署请走 Actions 快照通道。
 */
export function getToken() {
  if (cachedToken !== null) return cachedToken;
  let token = "";
  try {
    token = window.localStorage.getItem("gh_trends_token") || "";
  } catch {
    token = "";
  }
  cachedToken = token;
  return cachedToken;
}

export function setToken(token) {
  cachedToken = token || "";
  try {
    if (token) {
      window.localStorage.setItem("gh_trends_token", token);
    } else {
      window.localStorage.removeItem("gh_trends_token");
    }
  } catch {
    /* 隐私模式下写入失败可忽略，仅影响本次会话 */
  }
  return cachedToken;
}

function buildHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function withTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 从响应头读取速率限制信息。 */
function readRateLimit(res) {
  const limit = Number(res.headers.get("X-RateLimit-Limit") || 0);
  const remaining = Number(res.headers.get("X-RateLimit-Remaining") || 0);
  const reset = Number(res.headers.get("X-RateLimit-Reset") || 0) * 1000;
  return { limit, remaining, reset };
}

export class RateLimitError extends Error {
  constructor(info) {
    super("GitHub API 速率限制已用尽");
    this.name = "RateLimitError";
    this.rateLimit = info;
  }
}

/**
 * 带重试与速率限制识别的 fetch。
 * 403 + X-RateLimit-Remaining: 0 判定为限流，而不是普通鉴权失败。
 */
async function request(path, { retries = 1, ...init } = {}) {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await withTimeout(url, { ...init, headers: buildHeaders() });

      if (res.status === 403 || res.status === 429) {
        const rateLimit = readRateLimit(res);
        if (rateLimit.remaining === 0) {
          throw new RateLimitError(rateLimit);
        }
      }

      if (res.status === 404) {
        const err = new Error("资源不存在");
        err.status = 404;
        throw err;
      }

      if (!res.ok) {
        const err = new Error(`GitHub API 返回 ${res.status}`);
        err.status = res.status;
        err.rateLimit = readRateLimit(res);
        throw err;
      }

      return { data: await res.json(), rateLimit: readRateLimit(res) };
    } catch (err) {
      lastError = err;
      // 限流与 404 不重试：前者要等配额恢复，后者重试无意义。
      if (err instanceof RateLimitError || err.status === 404) throw err;
      if (attempt === retries) throw err;
    }
  }
  throw lastError;
}

/**
 * 拉取单个时间窗口内新建或活跃的仓库。
 * 用 pushed 区间而不是 created 区间：只有 created 会漏掉老项目的新版本爆发。
 */
export async function fetchTrendingRepos({ since, until, language, topic, perPage = 100, page = 1 }) {
  const params = new URLSearchParams({
    sort: "stars",
    order: "desc",
    per_page: String(Math.min(perPage, 100)),
    page: String(page),
  });
  if (since) params.set("pushed", `>=${since}`);
  if (until) params.set("pushed", `<=${until}`);
  if (language) params.set("language", language);
  if (topic) params.set("topic", topic);

  const { data, rateLimit } = await request(`/search/repositories?${params.toString()}`);
  return { items: data.items || [], rateLimit };
}

/** 拉取单个仓库详情。 */
export async function fetchRepo(fullName) {
  const { data, rateLimit } = await request(`/repos/${fullName}`);
  return { repo: data, rateLimit };
}

/**
 * 拉取 stargazer 时间序列（Star 增长曲线的原始数据）。
 * GitHub 对该接口做了分页上限保护，最多取到 400 页，这里只取最近 N 页。
 */
export async function fetchStarTimeline(fullName, pages = 3) {
  const perPage = 100;
  const first = await request(`/repos/${fullName}/stargazers?per_page=${perPage}&page=1`);
  const total = first.data.length;
  if (total < perPage) {
    return { pages: [first.data], truncated: false };
  }

  const rest = [];
  for (let p = 2; p <= Math.min(pages, 4); p += 1) {
    // 第 2 页取的是倒数第二页的区间，GitHub 的 stargazers 默认按时间正序返回。
    const res = await request(`/repos/${fullName}/stargazers?per_page=${perPage}&page=${p}`);
    if (!res.data.length) break;
    rest.push(res.data);
  }
  return { pages: [first.data, ...rest], truncated: true };
}

/** 读取某次响应留下的速率限制快照（供状态面板展示）。 */
export async function probeRateLimit() {
  const { rateLimit } = await request("/rate_limit", { retries: 0 });
  return rateLimit;
}
