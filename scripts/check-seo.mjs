#!/usr/bin/env node
/**
 * SEO 产物自检。
 *
 * 检查项覆盖「搜索引擎与阅读器真正会看的」东西：
 *   - 初始 HTML 里是否有实质内容（预渲染是否生效）
 *   - canonical / description / 结构化数据是否齐全且唯一
 *   - h1 是否唯一（多个 h1 会分散权重）
 *   - 内部链接是否存在（避免死链）
 *   - RSS / Atom / sitemap 的 XML 是否合法、条目是否非空
 *   - guid 是否稳定、isPermaLink 是否正确
 *
 * 用法：node scripts/check-seo.mjs
 * 退出码：0 = 全部通过，1 = 有问题
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "_prerendered");

const problems = [];
const warnings = [];

const fail = (msg) => problems.push(msg);
const warn = (msg) => warnings.push(msg);

const exists = (p) => stat(p).then(() => true).catch(() => false);

/** 粗略提取标签外的可见文本。 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** XML 基本良构性检查：标签配平 + 声明存在。 */
function checkXml(xml, label) {
  if (!xml.startsWith("<?xml")) {
    fail(`${label}: 缺少 XML 声明`);
    return;
  }
  // 只统计真正的容器标签（有对应闭合标签的）：
  // rss/channel/item/entry/feed 等。图片等自闭合标签不参与。
  const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "area", "base", "col", "embed", "source", "track", "wbr"]);
  const stack = [];
  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9:_-]*)([^>]*?)(\/)?>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, name, , selfClose] = m;
    const key = name.toLowerCase();
    if (VOID.has(key) || selfClose) continue;
    if (closing) {
      if (stack[stack.length - 1] === key) stack.pop();
      else {
        fail(`${label}: 标签交叉 —— </${key}> 与 <${stack[stack.length - 1] || "?"}> 不匹配`);
        break;
      }
    } else {
      stack.push(key);
    }
  }
  if (stack.length) {
    fail(`${label}: 标签未闭合 —— ${stack.join(" > ")}`);
  }
  if (/�/.test(xml)) {
    fail(`${label}: 含替换字符 U+FFFD，编码有问题`);
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  if (!(await exists(OUT))) {
    console.error("✗ 找不到 _prerendered 目录，请先运行：node scripts/prerender.mjs");
    process.exit(1);
  }

  /* ---- 页面检查 ---- */
  const pages = [
    { file: "index.html", minText: 3000, minRows: 10, label: "首页" },
    { file: "period/week.html", minText: 3000, minRows: 10, label: "周榜页" },
    { file: "period/month.html", minText: 3000, minRows: 10, label: "月榜页" },
    { file: "period/quarter.html", minText: 3000, minRows: 10, label: "季度榜页" },
    { file: "period/half.html", minText: 3000, minRows: 10, label: "半年榜页" },
    { file: "period/year.html", minText: 3000, minRows: 10, label: "年度榜页" },
    { file: "overview.html", minText: 0, minRows: 0, label: "总览页" },
    { file: "favorites.html", minText: 0, minRows: 0, label: "收藏页" },
    { file: "compare.html", minText: 0, minRows: 0, label: "对比页" },
  ];

  console.log("═══ 页面检查 ═══");
  for (const p of pages) {
    const file = join(OUT, p.file);
    if (!(await exists(file))) {
      fail(`${p.label} (${p.file}): 文件不存在`);
      continue;
    }
    const html = await readFile(file, "utf8");
    const text = visibleText(html);

    // 实质内容
    if (text.length < p.minText) {
      fail(`${p.label}: 可见文本仅 ${text.length} 字符（应 ≥ ${p.minText}）—— 预渲染可能未生效`);
    }

    // 表格行
    const rows = (html.match(/<tr/g) || []).length;
    if (rows < p.minRows) {
      fail(`${p.label}: 表格行仅 ${rows} 行（应 ≥ ${p.minRows}）`);
    }

    // h1 唯一性
    const h1s = (html.match(/<h1[\s>]/gi) || []).length;
    if (h1s !== 1) {
      fail(`${p.label}: h1 数量为 ${h1s}（应为 1）`);
    }

    // title
    const titles = [...html.matchAll(/<title>([^<]*)<\/title>/gi)].map((m) => m[1]);
    if (titles.length !== 1) {
      fail(`${p.label}: title 数量为 ${titles.length}（应为 1）`);
    } else {
      const t = titles[0];
      if (t.length < 10) fail(`${p.label}: title 过短（${t.length} 字符）`);
      if (t.length > 80) warn(`${p.label}: title 偏长（${t.length} 字符），搜索结果可能被截断`);
    }

    // description
    const descs = [...html.matchAll(/<meta name="description" content="([^"]*)"/gi)].map((m) => m[1]);
    if (descs.length !== 1) {
      fail(`${p.label}: description 数量为 ${descs.length}（应为 1）`);
    } else {
      const d = descs[0];
      if (d.length < 50) fail(`${p.label}: description 过短（${d.length} 字符，应 ≥ 50）`);
      if (d.length > 300) warn(`${p.label}: description 偏长（${d.length} 字符）`);
    }

    // canonical
    const cans = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/gi)].map((m) => m[1]);
    if (cans.length !== 1) {
      fail(`${p.label}: canonical 数量为 ${cans.length}（应为 1）`);
    } else if (!cans[0].startsWith("https://")) {
      fail(`${p.label}: canonical 不是绝对 URL —— ${cans[0]}`);
    }

    // 结构化数据
    if (!/application\/ld\+json/.test(html)) {
      fail(`${p.label}: 缺少 JSON-LD 结构化数据`);
    } else {
      const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
      for (const b of blocks) {
        try {
          JSON.parse(b.replace(/<[^>]+>/g, ""));
        } catch (e) {
          fail(`${p.label}: JSON-LD 解析失败 —— ${e.message}`);
        }
      }
    }

    // Open Graph
    for (const prop of ["og:title", "og:description", "og:url", "og:type"]) {
      if (!html.includes(`property="${prop}"`)) {
        fail(`${p.label}: 缺少 ${prop}`);
      }
    }

    // Twitter Card
    if (!html.includes('name="twitter:card"')) {
      fail(`${p.label}: 缺少 twitter:card`);
    }

    // feed 自动发现
    if (!html.includes('type="application/rss+xml"')) {
      fail(`${p.label}: 缺少 RSS 自动发现标签`);
    }
    if (!html.includes('type="application/atom+xml"')) {
      fail(`${p.label}: 缺少 Atom 自动发现标签`);
    }

    console.log(`  ✓ ${p.label.padEnd(10)} 文本=${String(text.length).padStart(5)} 行=${String(rows).padStart(3)}`);
  }

  /* ---- 详情页抽样检查 ---- */
  console.log("\n═══ 详情页检查（抽样 5 个）═══");
  const projDir = join(OUT, "project");
  const owners = await stat(projDir).then((s) => s.isDirectory()).catch(() => false);
  if (!owners) {
    fail("缺少 project/ 目录");
  } else {
    const { readdir } = await import("node:fs/promises");
    const ownerList = (await readdir(projDir)).slice(0, 5);
    for (const owner of ownerList) {
      const ownerDir = join(projDir, owner);
      const files = (await readdir(ownerDir)).filter((f) => f.endsWith(".html")).slice(0, 1);
      for (const f of files) {
        const html = await readFile(join(ownerDir, f), "utf8");
        const text = visibleText(html);
        const h1s = (html.match(/<h1[\s>]/gi) || []).length;
        const rows = (html.match(/<tr/g) || []).length;
        if (text.length < 200) fail(`详情页 ${owner}/${f}: 可见文本仅 ${text.length} 字符`);
        if (h1s !== 1) fail(`详情页 ${owner}/${f}: h1 数量为 ${h1s}`);
        if (rows < 2) fail(`详情页 ${owner}/${f}: 表格行仅 ${rows}`);
        console.log(`  ✓ ${owner}/${f}`.padEnd(24) + ` 文本=${String(text.length).padStart(4)} h1=${h1s} 行=${rows}`);
      }
    }
  }

  /* ---- Feed 检查 ---- */
  console.log("\n═══ 订阅源检查 ═══");
  for (const [file, label, itemTag] of [
    ["feed.xml", "RSS 2.0", "item"],
    ["atom.xml", "Atom 1.0", "entry"],
  ]) {
    const f = join(OUT, file);
    if (!(await exists(f))) {
      fail(`${label}: 文件不存在`);
      continue;
    }
    const xml = await readFile(f, "utf8");
    checkXml(xml, label);

    const items = (xml.match(new RegExp(`<${itemTag}>`, "g")) || []).length;
    if (items === 0) fail(`${label}: 无条目`);
    if (items > 100) warn(`${label}: 条目数 ${items} 偏多`);

    // guid / id 必须唯一且稳定
    const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
    // Atom 的 feed 根元素也有 <id>，只取 entry 内部的
    const ids = [...xml.matchAll(/<entry>[\s\S]*?<id>([^<]+)<\/id>[\s\S]*?<\/entry>/g)].map((m) => m[1]);
    const keys = guids.length ? guids : ids;
    if (keys.length !== items) {
      fail(`${label}: guid/id 数量 ${keys.length} ≠ 条目数 ${items}`);
    }
    if (new Set(keys).size !== keys.length) {
      fail(`${label}: guid/id 存在重复`);
    }
    for (const k of keys) {
      if (!k.startsWith("http://") && !k.startsWith("https://")) {
        fail(`${label}: guid/id 必须是绝对 URL —— ${k}`);
        break;
      }
    }

    // RSS: isPermaLink
    if (file === "feed.xml") {
      if (!/isPermaLink="true"/.test(xml)) {
        fail("RSS 2.0: guid 缺少 isPermaLink=\"true\"（专业聚合服务需要）");
      }
      // pubDate 必须是 RFC 822
      const dates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]);
      for (const d of dates.slice(0, 3)) {
        if (Number.isNaN(Date.parse(d))) {
          fail(`RSS 2.0: pubDate 格式非法 —— ${d}`);
          break;
        }
      }
    }

    // Atom: updated 必须是 ISO 8601
    if (file === "atom.xml") {
      const dates = [...xml.matchAll(/<updated>([^<]+)<\/updated>/g)].map((m) => m[1]);
      for (const d of dates.slice(0, 3)) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(d)) {
          fail(`Atom 1.0: updated 必须是 ISO 8601 —— ${d}`);
          break;
        }
      }
      if (!xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
        fail("Atom 1.0: 缺少命名空间声明");
      }
    }

    console.log(`  ✓ ${label.padEnd(10)} 条目=${items} guid唯一=${new Set(keys).size === keys.length}`);
  }

  /* ---- sitemap 检查 ---- */
  console.log("\n═══ Sitemap 检查 ═══");
  {
    const f = join(OUT, "sitemap.xml");
    if (!(await exists(f))) {
      fail("sitemap.xml 不存在");
    } else {
      const xml = await readFile(f, "utf8");
      checkXml(xml, "sitemap.xml");
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      if (urls.length === 0) fail("sitemap.xml: 无 URL");
      if (urls.length > 50000) fail("sitemap.xml: URL 超过 50000 上限");
      if (new Set(urls).size !== urls.length) fail("sitemap.xml: 存在重复 URL");

      for (const u of urls) {
        if (!/^https:\/\//.test(u)) {
          fail(`sitemap.xml: URL 必须是绝对 HTTPS —— ${u}`);
          break;
        }
      }

      // 每个 URL 都必须有对应的文件（相对站点根）
      const base = "https://motao123.github.io/github-trends-site/";
      let missing = 0;
      for (const u of urls) {
        const rel = u.replace(base, "");
        const local = rel ? join(OUT, rel) : join(OUT, "index.html");
        if (!(await exists(local))) {
          missing += 1;
          if (missing <= 3) fail(`sitemap.xml: URL 无对应文件 —— ${rel}`);
        }
      }
      if (missing > 3) fail(`sitemap.xml: 共 ${missing} 个 URL 无对应文件`);

      console.log(`  ✓ sitemap    URL=${urls.length} 全部有对应文件=${missing === 0}`);
    }
  }

  /* ---- robots 检查 ---- */
  console.log("\n═══ robots.txt 检查 ═══");
  {
    const f = join(OUT, "robots.txt");
    if (!(await exists(f))) {
      fail("robots.txt 不存在");
    } else {
      const txt = await readFile(f, "utf8");
      if (!/User-agent:\s*\*/i.test(txt)) fail("robots.txt: 缺少 User-agent");
      if (!/Sitemap:/i.test(txt)) fail("robots.txt: 缺少 Sitemap 声明");
      else if (!/Sitemap:\s*https:\/\//.test(txt)) fail("robots.txt: Sitemap 必须是绝对 URL");
      console.log("  ✓ robots.txt");
    }
  }

  /* ---- 内部链接检查 ---- */
  console.log("\n═══ 内部链接检查 ═══");
  {
    const html = await readFile(join(OUT, "index.html"), "utf8");
    // 只查 HTML 页面链接，排除样式表等资源
    const links = [...html.matchAll(/href="(\.\/[^"#?]+\.html?)"/g)].map((m) => m[1]);
    let broken = 0;
    for (const l of new Set(links)) {
      const p = resolve(OUT, l.replace(/^\.\//, ""));
      if (!(await exists(p))) {
        broken += 1;
        if (broken <= 3) fail(`内部链接失效 —— ${l}`);
      }
    }
    console.log(`  ✓ 内部链接 ${new Set(links).size} 个，失效 ${broken} 个`);
  }

  /* ---- 汇总 ---- */
  console.log("\n" + "═".repeat(50));
  if (warnings.length) {
    console.log(`⚠ ${warnings.length} 项提示：`);
    for (const w of warnings) console.log(`   · ${w}`);
  }
  if (problems.length) {
    console.log(`✗ ${problems.length} 项问题：`);
    for (const p of problems) console.log(`   · ${p}`);
    process.exit(1);
  }
  console.log("✓ SEO 自检全部通过");
}

main().catch((err) => {
  console.error("✗ 自检异常：", err);
  process.exit(1);
});
