# GitHub API 速率限制说明

本文档说明本项目如何应对 GitHub REST API 的限流机制，以及排查相关问题时需要的背景知识。

## 两套独立的限流

GitHub REST API 有两个彼此独立的配额体系，很容易混淆：

| 配额 | 匿名 | 认证（PAT） | 用途 |
|------|------|-------------|------|
| **Primary rate limit** | 60 次/小时 | 5000 次/小时 | 除 search 外的所有接口 |
| **Secondary rate limit** | search 接口另有约束 | 同左 | 短时间内请求过多会触发 403/429 |

## Primary rate limit

### 响应头

每个响应都带上限信息：

```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4860
X-RateLimit-Used: 140
X-RateLimit-Reset: 1758272400
```

- `Remaining` 归零后开始返回 403
- `Reset` 是 Unix 时间戳，到点自动恢复

### 本项目的用量

抓取脚本每个周期 1 次请求，5 个周期共 5 次：

```js
for (const period of PERIODS) {          // 5 个周期
  const data = await api(`/search/repositories?...`);  // 1 次
}
```

每 2 小时跑一次 = 每天 60 次 = 每小时 0.5 次。**配额占用不到 0.01%**。

前提是配置了 PAT。未配置时每小时只有 60 次，跑 12 轮就耗尽。

## Secondary rate limit（search 接口）

即使 Primary 配额充足，search 接口仍可能返回 **403 + 422**：

| 状态码 | 含义 | 触发条件 |
|--------|------|----------|
| 403 | 触发了并发/频率限制 | 短时间内大量请求 |
| 422 | 查询被拒绝 | 主要由频率限制引起 |

422 的官方说明比较含糊，社区经验是：**未认证时约 10 次/分钟**。

### 本项目的防护

```js
// 每次请求后强制间隔
await sleep(2500);   // 2.5 秒 > 10 次/分钟的间隔要求

// 422 时退避重试
if (res.status === 422) {
  await sleep(60000);   // 等 60 秒
  continue;             // 重试
}
```

5 个周期 × 2.5 秒 ≈ 12.5 秒总耗时，对定时任务完全可接受。

## 本项目的三层降级策略

```
第 1 层：读静态快照（public/data/trending.json）
         └─ Actions 每 2 小时预生成，访客零 API 调用

第 2 层：读 localStorage 缓存
         └─ 快照不可用时兜底，TTL 2 小时

第 3 层：直连 api.github.com
         └─ 前两层都失败（仅本地开发或首次部署时）
```

优先级由 `src/lib/data.js` 的 `loadSnapshot()` 实现：

```js
export async function loadSnapshot({ force = false, signal } = {}) {
  // 1. 内存/localStorage 缓存且未过期
  if (!force) {
    const local = readLocalCache();
    if (isFresh(local)) return { source: "local", snapshot: local };
  }

  // 2. 静态快照（多个候选路径）
  for (const path of SNAPSHOT_PATHS) {
    const res = await fetch(path, { signal, cache: "no-cache" });
    // ...
  }

  // 3. 直连 API 现算
  const snapshot = await buildLiveSnapshot(signal);
  return { source: "live", snapshot };
}
```

总览面板的「数据源与缓存状态」卡片会显示当前命中的是哪一层。

## 限流判定逻辑

**关键点：403 不一定是限流。** 可能是权限不足、token 失效、二次验证未完成。

本项目在 `src/lib/github-api.js` 里的判定：

```js
if (res.status === 403 || res.status === 429) {
  const rateLimit = readRateLimit(res);
  if (rateLimit.remaining === 0) {      // ← 必须是配额真的耗尽
    throw new RateLimitError(rateLimit);
  }
  // 否则按普通错误继续处理
}
```

只有 `Remaining === 0` 才判定为限流，避免把权限错误误报成限流。

## 界面上的限流提示

触发限流时，用户会看到一张琥珀色提示卡（`rateLimitState()`）：

- 已用额度 / 总配额
- 配额重置的准确时间
- 建议方案（配置 PAT）

同时页面**仍展示缓存数据**，不会白屏。这是有意的设计：
数据可能滞后几分钟，但对读者来说有内容总比空白好。

## 排查清单

### 日志出现「速率限制已用尽」

```bash
# 1. 确认令牌是否生效
node -e "console.log(process.env.GITHUB_TOKEN ? '有令牌' : '无令牌')"

# 2. 手动查一次配额
curl -s https://api.github.com/rate_limit | head -20
```

匿名调用的 `rate_limit` 端点**不消耗配额**，可以安全用来诊断。

### 想知道还剩多少配额

```bash
curl -s https://api.github.com/rate_limit | \
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const r=JSON.parse(s).rate;
    console.log(\`剩余 \${r.remaining}/\${r.limit}，重置于 \${new Date(r.reset*1000).toLocaleString()}\`);
  })"
```

### 遇到 422

GitHub 对 422 的说明不明确，但处理方式一致：等待后重试。

```bash
# 等待 60 秒后再跑
sleep 60 && node scripts/fetch-trending.mjs --once
```

如果持续 422，检查是否同时有多个 fetch 任务在跑（本地 + Actions）：

```bash
# 列出当前运行中的 workflow
gh run list --workflow="fetch-data.yml" --status=in_progress
```

## 令牌消耗的意外来源

本项目**不会**在以下情况调用 API：

- 访客打开任何页面（读快照）
- 切换周期 / 筛选 / 排序（纯前端过滤）
- 收藏 / 对比（纯 localStorage）
- 主题切换（纯 CSS 变量）

唯一会调用 API 的场景是**快照缺失时的兜底**。所以线上部署完成后，
API 调用量应该恒定在「每 2 小时 5 次」，与访客数无关。

## 官方文档

- [REST API 速率限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [ Secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)
- [搜索 API 限制](https://docs.github.com/en/rest/search#rate-limit)
