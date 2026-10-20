#!/usr/bin/env node
/**
 * 零依赖静态服务器，用于本地验证。
 * 用法：node scripts/serve.mjs [port] [root]
 *
 *   node scripts/serve.mjs              # 以仓库根为根目录
 *   node scripts/serve.mjs 4180 _site   # 以 _site/ 为根目录（预览预渲染产物）
 *
 * 注意：这是 file:// 之外最省事的本地验证方式。ES Module 在 file:// 协议下
 * 会被 CORS 拦截，因此必须通过 http 打开。
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", process.argv[3] || ".");
const PORT = Number(process.argv[2]) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  // RSS / Atom / sitemap 的 Content-Type 必须正确，
  // 否则阅读器与搜索引擎可能拒绝解析。
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    // 防目录穿越
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(ROOT, safe);

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }

    // 映射到 public/ 下的资源（/data/xxx.json → public/data/xxx.json）
    // 同时支持 /public/data/xxx.json 这种线上路径，本地与生产行为一致。
    if (!info) {
      for (const candidate of [join(ROOT, "public", safe), join(ROOT, safe.replace(/^\/public\//, "/"))]) {
        const stat0 = await stat(candidate).catch(() => null);
        if (stat0) {
          filePath = candidate;
          info = stat0;
          break;
        }
      }
    }

    if (!info) {
      const notFound = join(ROOT, "404.html");
      const html = await readFile(notFound);
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      res.end(html);
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`500 ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`本地服务已启动：http://localhost:${PORT}`);
  console.log(`  榜单页  http://localhost:${PORT}/index.html`);
  console.log(`  总览面板 http://localhost:${PORT}/overview.html`);
  console.log(`  详情页   http://localhost:${PORT}/project.html?full_name=facebook/react`);
  console.log("按 Ctrl+C 停止");
});
