<div align="center">

# 开源项目趋势统计站

### 追踪 GitHub 上真正在增长的开源项目

[![在线演示](https://img.shields.io/badge/在线演示-motao123.github.io%2Fgithub--trends--site-5046E5?style=for-the-badge&logo=github)](https://motao123.github.io/github-trends-site/)
[![Pages](https://img.shields.io/badge/GitHub%20Pages-已部署-success?style=for-the-badge&logo=githubactions)](https://motao123.github.io/github-trends-site/)
[![License](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](LICENSE)
[![无构建](https://img.shields.io/badge/构建-零依赖零构建-F59E0B?style=for-the-badge)](package.json)
[![更新频率](https://img.shields.io/badge/数据更新-每%202%20小时-5046E5?style=for-the-badge)](.github/workflows/fetch-data.yml)

[在线体验](https://motao123.github.io/github-trends-site/) · [部署文档](docs/DEPLOY.md) · [限流说明](docs/API.md) · [问题反馈](https://github.com/motao123/github-trends-site/issues)

</div>

---

## 这是什么

GitHub Trending 只有一个「今天」维度，但开源生态的热度有周期性——一个项目可能这周爆发、下周沉寂，也可能大版本发布后连续三个月爬升。

**开源项目趋势统计站**把 Star 的**真实增长量**作为核心指标，按周 / 月 / 季度 / 半年 / 年度五个窗口统计项目排名，而不是只看累计 Star 总量。

### 三个关键设计

| 设计 | 为什么这么做 |
|:--|:--|
| **增长量用快照做差** | GitHub API 不提供历史 Star 值。用相邻两次快照相减得到真实增量，而不是用累计值排序——后者会让 freecodecamp 这类老项目永远霸榜。 |
| **在榜判定用 `pushed`** | 用 `created` 只看新建仓库，会漏掉老项目的新版本爆发，而那往往才是真正的 trending。 |
| **访客零 API 消耗** | Actions 每 2 小时预生成快照，访客读本地文件。匿名 API 只有 60 次/小时，直连必然限流。 |

---

## 功能特性

### 📊 多周期榜单

- 五个时间窗口：周榜 / 月榜 / 季度 / 半年 / 年度
- 每周期独立抓取窗口内 Star 最高的 100 个项目，多周期合并去重
- 完整的统计字段：Star 总数、周期增长、Fork 数、主要语言、话题标签、创建与更新时间

### 🔍 筛选与排序

- **周期切换**：一键切换五个时间窗口
- **语言筛选**：从快照中自动提取所有出现的语言
- **话题筛选**：多标签「与」关系，点击即筛选
- **关键词搜索**：匹配项目名、描述与话题标签
- **五种排序**：Star 增长 / Star 总数 / Fork / 最近推送 / 创建时间，表头点击升降序切换

### 📈 项目详情

- **Star 日增长趋势图**：SVG 折线 + 面积，叠加累计曲线，30/90/365 天切换
- **各周期榜单成绩**：该项目在五个窗口下的排名与增量
- **项目元信息**：创建时间、最近推送、许可证、话题数、主要语言
- **统计口径说明**：每个数字怎么来的，页面上直接讲清楚

### ⭐ 收藏与对比

- 收藏保存在浏览器 `localStorage`，不上传任何服务器
- 最多 4 个项目横向对比：14 项指标并排 + 各周期增长对比条
- 底部托盘随时显示已选项目，超出上限有明确提示

### 🛡️ 完整状态处理

| 状态 | 表现 |
|:--|:--|
| 加载中 | 骨架屏占位，保持布局不跳动 |
| 空数据 | 说明原因 + 一键重置筛选 |
| 请求失败 | 错误码展示 + 重试按钮 + 降级提示 |
| API 限流 | 已用额度、重置时间、配置建议，**页面仍展示缓存数据** |

### 🎨 界面

- 浅色 / 深色双主题，跟随系统偏好，可手动覆盖
- 响应式：桌面 / 平板 / 移动三档断点
- 数值全部等宽字体 + `tabular-nums`，数字对齐不跳动
- 无障碍：语义化标签、`aria-pressed` 状态、`aria-sort` 排序标记、键盘可达
- 尊重 `prefers-reduced-motion`

---

## 技术栈

<div align="center">

| 层 | 选型 | 说明 |
|:--|:--|:--|
| **前端** | 原生 ES Modules | 无框架、无打包器，浏览器直接加载 |
| **样式** | 原生 CSS + 自定义属性 | 设计令牌集中在 `:root`，深色主题靠变量覆盖 |
| **图表** | 手写 SVG | 折线、面积、进度条均为 SVG path，无图表库 |
| **数据** | GitHub REST API | `search/repositories` 抓取，`stargazers` 补趋势 |
| **抓取** | Node.js 18+ 原生脚本 | 零依赖，仅用内置 `fetch` |
| **部署** | GitHub Actions + Pages | 定时抓取 + 自动部署，无服务器 |
| **授权** | MIT | 自由使用 |

</div>

### 为什么不用框架

这个项目的交互复杂度停留在「筛选 + 排序 + 渲染表格」。引入 React/Vue 会增加构建步骤、依赖管理和潜在的供应链风险，而收益接近于零。

**纯静态 + 零依赖**带来三个实际好处：克隆下来就能跑、部署不需要任何配置、十年后大概率还能打开。

---

## 快速开始

### 环境要求

```
Node.js >= 18
```

仅用于抓取与本地预览。**浏览线上站点不需要任何环境**。

### 克隆与运行

```bash
# 1. 克隆
git clone https://github.com/motao123/github-trends-site.git
cd github-trends-site

# 2. 安装依赖（实际上没有依赖，这一步只是确认环境）
npm install

# 3. 生成数据快照（可选，线上已有快照）
GH_PAT=ghp_your_token node scripts/fetch-trending.mjs --once

# 4. 启动本地服务
npm run dev
```

打开 <http://localhost:4173/index.html>。

> **不要直接双击 HTML 文件打开。** ES Module 在 `file://` 协议下会被浏览器的 CORS 策略拦截，页面会白屏。必须通过 `http://` 访问。

### npm 脚本

| 命令 | 作用 |
|:--|:--|
| `npm run dev` | 启动本地静态服务器（默认 4173 端口） |
| `npm run fetch` | 抓取一次数据并更新快照 |
| `npm run fetch:once` | 同上，抓取后退出（供 CI 使用） |

---

## 使用说明

### 榜单页

1. 顶部 **周期切换**选择时间窗口
2. **筛选栏**按语言、话题标签过滤，或用搜索框匹配项目
3. 点击 **表头**切换排序字段，再次点击切换升降序
4. 点击项目名进入**详情页**
5. 点击 ⭐ **收藏**，或 **加入对比**（最多 4 个）

> **排序边界**：「暂无基线」的项目（缺少历史快照）始终排在最后，不会与真实的零增长项目混淆。

### 详情页

- 顶部展示项目元信息与本周排名
- 趋势图右上角可切换 30 天 / 90 天 / 全年
- 底部「统计口径说明」解释每个数字的来源

### 对比页

最多 4 个项目并排对比，包含 14 项静态指标与各周期增长对比条。增长最高的一项会标注「领先」。

### 键盘操作

| 按键 | 作用 |
|:--|:--|
| `Tab` | 在筛选控件间移动焦点 |
| `Enter` / `Space` | 激活当前焦点按钮 |

---

## 配置项

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|:--|:--:|:--|:--|
| `GH_PAT` | 建议 | — | Personal Access Token。匿名限额 60 次/时，配置后 5000 次/时 |
| `PORT` | 否 | `4173` | 本地服务器端口 |

令牌读取顺序：`GH_PAT` → `GITHUB_PAT` → `GITHUB_TOKEN` → `GH_TOKEN`。

> ⚠️ **Actions 的 Secret 不能命名为 `GITHUB_TOKEN`**，GitHub 会返回 `HTTP 422: Secret names must not start with GITHUB_`。必须用其他名称，本项目统一用 `GH_PAT`。

### GitHub Actions Secret

抓取任务需要令牌才能突破匿名限额：

```bash
# 在仓库页面配置，或用 CLI
gh secret set GH_PAT --repo <owner>/<repo>
```

**推荐的最小权限**（Fine-grained token）：

```
Permissions → Repository permissions → Metadata: Read-only
```

本项目只读取公开仓库，不需要任何写权限。

### 可调整的行为

| 想改什么 | 改哪里 |
|:--|:--|
| 抓取频率 | `.github/workflows/fetch-data.yml` 的 `cron` |
| 周期窗口天数 | `src/lib/data.js` 的 `PERIODS` |
| 单周期抓取数量 | `scripts/fetch-trending.mjs` 的 `per_page`（上限 100） |
| 历史序列保留天数 | `scripts/fetch-trending.mjs` 的 `HISTORY_DAYS`（默认 400） |
| 主题配色 | `src/styles/main.css` 的 `:root` 变量 |
| 对比项目上限 | `src/lib/store.js` 的 `COMPARE_LIMIT` |

---

## 部署

完整步骤见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

### 三步部署

```bash
# 1. 推送到仓库
git push origin main

# 2. 配置 Secret（Settings → Secrets and variables → Actions → New repository secret）
#    Name: GH_PAT

# 3. 启用 Pages（Settings → Pages → Source 选 GitHub Actions）
```

> ⚠️ **Source 必须选 GitHub Actions。** 选 "Deploy from a branch" 会走 Jekyll 流程只发布 `_site/` 目录，导致 `src/` 下的模块全部 404，页面全白。

### 工作流说明

| 工作流 | 触发 | 作用 |
|:--|:--|:--|
| `fetch-data.yml` | 每 2 小时 / 手动 | 抓取数据 → 提交快照 → 触发部署 |
| `deploy-pages.yml` | push 到 main / 手动 | 组装产物 → 上传 → 发布到 Pages |

`deploy-pages.yml` 会显式组装 staging 目录，只发布运行时必需的文件（页面入口、`src/`、`public/`、`.nojekyll`），避免把 workflow、docs 等开发文件一并上传。

### 后续更新流程

```bash
# 1. 本地修改并验证
npm run dev

# 2. 语法自检（避免括号不匹配这类隐蔽问题）
for f in src/pages/*.js src/lib/*.js src/components/*.js scripts/*.mjs; do
  node --check "$f" || echo "FAIL $f"
done

# 3. 提交并推送
git add -A
git commit -m "feat: 新增功能描述"
git push origin main

# 4. 查看部署进度
gh run watch
# 或网页端 Actions 标签页
```

**触发规则**：`deploy-pages.yml` 配置了 `paths-ignore`，只改 `*.md` 或 `docs/` 不会触发重新部署。

**首次部署**通常 1–2 分钟完成。

### 自定义域名

```bash
cp CNAME.example CNAME
# 编辑 CNAME，写入 trends.example.com
git add CNAME && git commit -m "chore: 添加自定义域名" && git push
```

然后在域名服务商添加 CNAME 记录指向 `motao123.github.io`，并在 Settings → Pages 勾选 **Enforce HTTPS**。

---

## 常见问题

<details>
<summary><b>为什么增长量显示「暂无基线」？</b></summary>

这不是 bug，是数据机制的固有约束。

Star 增长量需要两次快照做差才能算出。首次部署时只有一份快照，增长量必然为空。**等抓取任务跑完第二轮（2 小时后）就会出现真实数值**，趋势曲线则需要 2–3 天积累。
</details>

<details>
<summary><b>抓取任务报「速率限制已用尽」</b></summary>

三种可能：

1. **Secret 未配置** — Actions 日志的「认证方式」应显示「已配置令牌（GH_PAT）」，若显示「匿名」说明 Secret 没生效
2. **令牌过期** — 重新生成并更新 Secret
3. **短时间内手动触发多次** — 等配额重置即可

查看剩余配额（不消耗配额）：

```bash
gh api rate_limit
```
</details>

<details>
<summary><b>部署成功但页面空白</b></summary>

最常见原因：Settings → Pages 的 Source 选成了 "Deploy from a branch"。

Jekyll 模式只发布 `_site/` 目录，本项目页面在仓库根目录，会导致 `src/styles/main.css` 等资源 404。改成 **GitHub Actions** 后重新触发部署。
</details>

<details>
<summary><b>数据不更新</b></summary>

1. Actions 页看 `Fetch Trending Data` 最近一次运行是否成功
2. **即使成功也可能没有新 commit** —— 数据没变化时会主动跳过提交，这是正常的
3. 检查快照文件的 `generatedAt` 字段：

```bash
curl -s https://motao123.github.io/github-trends-site/public/data/trending.json | head -5
```
</details>

<details>
<summary><b>本地打开是白屏</b></summary>

直接双击 HTML 用 `file://` 协议打开会导致 ES Module 被 CORS 拦截。

必须通过本地服务器访问：`node scripts/serve.mjs`，然后打开 `http://localhost:4173/index.html`。
</details>

<details>
<summary><b>能改成 React / Vue 吗？</b></summary>

可以，但需要重新设计构建与部署流程。当前架构的价值在于零构建、零依赖、十年后大概率还能打开。

如果确实需要组件化，建议先加构建工具（Vite），保留数据层与 Actions 的设计不变。
</details>

<details>
<summary><b>数据准吗？</b></summary>

统计口径透明：

- 增长量 = 相邻快照的 Star 数相减，是**真实增量**而非估算
- 在榜判定基于 `pushed` 时间窗口，捕捉活跃项目而非新建项目
- 每周期取窗口内 Star 最高的 100 个项目，受 GitHub search 接口单页上限限制
- 数据延迟：最长 2 小时（取决于抓取任务执行时间）

页面上的「统计口径说明」区块把这些都写明了。
</details>

---

## 贡献指南

欢迎任何形式的贡献。

### 提交 Issue

请包含：

- 复现步骤
- 期望行为 vs 实际行为
- 浏览器与控制台报错（如有）
- 截图（如是界面问题）

### 提交 PR

```bash
git checkout -b feat/your-feature
# ... 修改 ...
git commit -m "feat: 简要描述"
git push origin feat/your-feature
```

**约定**：

- 保持零依赖 —— 新增运行时依赖需要先讨论
- 改动涉及 UI 时，同时验证浅色与深色主题
- 不要手动编辑 `public/data/trending.json`，它由 CI 自动生成

### 代码风格

- 原生 ES Modules，不使用打包器
- 注释解释「为什么」，而非「做了什么」
- 涉及数据口径的改动，请在 PR 描述中说明

---

## 许可证

<div align="center">

**MIT License**

Copyright © 2026 motao123

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

</div>

---

## 联系方式

<table align="center">
<tr>
<td width="50%">

**问题反馈**
[提交 Issue](https://github.com/motao123/github-trends-site/issues/new/choose)

</td>
<td width="50%">

**在线体验**
[motao123.github.io/github-trends-site](https://motao123.github.io/github-trends-site/)

</td>
</tr>
<tr>
<td align="center">

**GitHub**
[@motao123](https://github.com/motao123)

</td>
<td align="center">

**Email**
[netyc@vip.qq.com](mailto:netyc@vip.qq.com)

</td>
</tr>
</table>

---

<div align="center">

**[⬆ 返回顶部](#开源项目趋势统计站)**

*数据来源 GitHub REST API · 每 2 小时自动更新 · 由 GitHub Actions 驱动*

</div>
