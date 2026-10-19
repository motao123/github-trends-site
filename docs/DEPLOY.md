# GitHub Pages 部署文档

本文档覆盖从零部署到自定义域名的完整流程。README 里有简版，这里是详细版。

## 前置条件

- GitHub 账号
- Node.js 18+（仅本地需要，部署到 Pages 不需要）
- 一个 GitHub 仓库（公开或私有都可，私有仓库需要 Pages 付费方案）

## 一、本地准备

```bash
git clone <你的仓库地址> github-trends-site
cd github-trends-site

# 生成首份数据快照（可选，Pages 部署后 Actions 也会自动生成）
GITHUB_TOKEN=ghp_xxx node scripts/fetch-trending.mjs --once

# 本地预览
node scripts/serve.mjs
```

确认 <http://localhost:4173/index.html> 能正常显示项目列表再往下走。

## 二、创建 Personal Access Token

抓取脚本需要令牌才能突破匿名 60 次/小时 的限制。

### Fine-grained token（推荐）

1. 访问 <https://github.com/settings/personal-access-tokens/new>
2. **Token name**: `github-trends-site`
3. **Expiration**: 90 天（到期后重新生成，或选 No expiration 但需自行管理）
4. **Repository access**: Public repositories → Only select repositories you choose → 选中本仓库
5. **Permissions → Repository permissions**:
   - `Metadata: Read-only`（必需，用于读取仓库信息）
   - 其余权限留空
6. 点击 **Generate token**，立即复制（离开页面后无法再看）

> **最简权限说明**：本项目只调用公开仓库的读取接口，因此 `Metadata: Read-only` 就够了。
> 不需要 `Contents: Read and write` —— 那是工作流自己用 `GITHUB_TOKEN` 自动获得的。

### Classic token（备选）

若 Fine-grained 遇到问题，可退回 classic：勾选 `public_repo` 即可。

## 三、配置仓库 Secret

令牌不能写进代码或 workflow 文件，必须走 Secret：

1. 进入仓库 → **Settings** → **Secrets and variables** → **Actions** tab
2. 点击 **New repository secret**
3. 填写：
   - **Name**: `GITHUB_TOKEN`
   - **Secret**: 粘贴上一步的令牌
4. 保存

验证：进入 Actions 页面能看到该 Secret 存在（只显示名称，不显示值）。

## 四、启用 GitHub Pages

1. 仓库 → **Settings** → **Pages**
2. **Build and deployment → Source** 选 **GitHub Actions**

```
┌─────────────────────────────────────────┐
│  Source                                 │
│  ○ Deploy from a branch                 │  ← 不要选这个
│  ● GitHub Actions            ← 选这个    │
└─────────────────────────────────────────┘
```

3. 保存

> ⚠️ **必须选 GitHub Actions。** 选 "Deploy from a branch" 会走 Jekyll 流程，只发布 `_site/` 目录，
> 而本项目的页面在仓库根目录，部署后 `index.html` 存在但 `src/styles/main.css` 404，页面全白。

## 五、触发与验证

### 首次触发

进入 **Actions** 标签页：

| Workflow | 操作 |
|----------|------|
| `Fetch Trending Data` | 手动点 **Run workflow**（选 main 分支） |
| `Deploy to GitHub Pages` | push 到 main 会自动触发；也可手动 Run workflow |

### 检查点

**1. 抓取任务成功**

日志应包含：

```
▸ GitHub 开源趋势抓取开始
  认证方式：已配置 GITHUB_TOKEN
  · 抓取 week（pushed >= 2026-10-12）…
    返回 100 个，累计 100 个项目
  ...
▸ 完成
  项目数：1xx
  写入：/home/runner/work/.../public/data/trending.json
```

**2. 提交成功**

抓取任务会看到一次 commit：`chore(data): 更新趋势快照 2026-10-19 13:04 UTC`。
这一步同时会触发部署 workflow。

**3. 部署成功**

`Deploy to GitHub Pages` 日志末尾：

```
deployment url: https://<用户名>.github.io/<仓库名>/
```

**4. 线上可访问**

打开该 URL，应能看到榜单表格。检查浏览器 DevTools：

- Network 面板确认请求的是 `/<仓库名>/public/data/trending.json` 且状态 200
- 不应有指向 `api.github.com` 的请求（有则说明快照路径错了）

## 六、定时任务说明

`.github/workflows/fetch-data.yml` 配置为每 2 小时一次：

```yaml
on:
  schedule:
    - cron: "0 */2 * * *"
```

### 为什么是 2 小时

- 每 2 小时跑 1 次，每次 5 个请求 = 60 次/天，远低于 5000/时的限制
- 2 小时的粒度足以反映 trending 变化
- GitHub 的 schedule 在繁忙时可能延迟 5–15 分钟，属正常现象

### 修改频率

改 cron 表达式即可，注意 cron 是 UTC 时区：

```yaml
- cron: "0 */4 * * *"    # 每 4 小时
- cron: "30 0,12 * * *"  # 每天 00:30 和 12:30（UTC）
```

**不要改成每小时。** 虽然配额够，但连续 commit 会让部署频繁触发，没必要。

### 并发保护

workflow 里设了 `concurrency: group: fetch-trending`，防止上一次没跑完就叠加下一次。search 接口本身有二级限流，叠加请求容易触发 422。

## 七、路由刷新处理

本项目是**多页结构**而非 SPA，所以常见的 404 刷新问题在这里的表现不同：

| 访问方式 | 结果 |
|----------|------|
| `/index.html` | 正常 |
| `/overview.html` | 正常 |
| `/overview`（无扩展名） | 命中 `404.html` → 自动跳转到 `/overview.html` |
| `/project.html?full_name=a/b` | 正常，查询参数保留 |

`404.html` 里的脚本维护了一个路径映射表：

```js
var map = {
  "/": "index.html",
  "/overview": "overview.html",
  "/favorites": "favorites.html",
  "/compare": "compare.html",
  "/project": "project.html",
};
```

**新增页面时记得同步这张表**，否则无扩展名访问会 404。

## 八、自定义域名

### 1. 添加 CNAME 文件

在仓库根目录创建 `CNAME`：

```
trends.example.com
```

提交后部署任务会把它发布到站点根目录。

### 2. 配置 DNS

在域名服务商处添加 CNAME 记录：

| 类型 | 主机 | 指向 |
|------|------|------|
| CNAME | `trends` | `<用户名>.github.io` |

### 3. 等待验证

DNS 生效通常需要几分钟到 48 小时。GitHub 会在 Settings → Pages 显示：

```
Your site is live at https://trends.example.com
```

### 4. 开启 HTTPS

Settings → Pages → 勾选 **Enforce HTTPS**。

GitHub 会自动申请并续期 Let's Encrypt 证书。

### 排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 域名无法访问 | DNS 未生效 | `nslookup trends.example.com` 确认解析 |
| 资源 404 | CNAME 文件未提交 | 检查仓库根目录是否有 CNAME |
| HTTPS 灰色 | 证书签发中 | 等待 1 小时后刷新 |
| 频繁重定向 | 同时配了 A 记录和 CNAME | 删掉 A 记录，只留 CNAME |

## 九、常见问题

### 抓取任务报「速率限制已用尽」

**原因**：Secret 未配置，或令牌权限/有效期有问题。

**排查**：

1. Actions → `Fetch Trending Data` → 日志看「认证方式」那行
   - 显示「匿名」→ Secret 没生效，检查 Secret 名称必须是 `GITHUB_TOKEN`（全大写）
   - 显示「已配置」但仍限流 → 令牌已过期或被撤销，重新生成
2. 检查是否短时间内手动触发了多次

### 部署成功但页面空白

**原因**：Source 选成了 "Deploy from a branch"，Jekyll 只发布了 `_site/`。

**处理**：改成 "GitHub Actions"，重新触发部署。

### 页面显示「暂无基线」

**原因**：这是**正常行为**，不是 bug。

Star 增长量需要两次快照做差。刚部署时只有一份快照，增长量必然为空。
等 `Fetch Trending Data` 跑完第二轮（2 小时后）就会出现真实数值。

### 数据不更新

1. 确认 `Fetch Trending Data` 最近是否成功（Actions 页看最近一次运行）
2. 抓取任务即使成功也可能**没有新 commit**（数据没变化时会跳过提交），这是正常的
3. 检查快照文件的 `generatedAt` 字段是否更新：

```bash
curl -s https://<用户名>.github.io/<仓库名>/public/data/trending.json | head -6
```

### 本地 fetch 报 422

GitHub search 接口未认证时有 10 次/分钟 的二级限流。脚本已内置 2.5 秒间隔和 60 秒退避重试。
如果仍失败，等一分钟再试即可。

## 十、进阶：私有仓库

私有仓库的 Pages 需要 GitHub Pro/Team/Enterprise。

主要差异：

- 站点默认需要登录才能访问
- 访客仍不会消耗 API 额度（快照机制不变）
- `deploy-pages.yml` 无需修改

## 十一、卸载

删除仓库即可。已部署的站点会在几小时内下线。

如果只想停用 Pages 而保留仓库：Settings → Pages → Source 选 **None** → 保存。
