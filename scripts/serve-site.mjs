// Serves the built site (_site/) the way GitHub Pages does: under /LogicTrail/, with a trailing
// slash added to folders, 404.html for missing pages and byte ranges for the video. Opening the
// HTML files directly does not work: the build adds files the source pages need, and browsers
// refuse web fonts on file:// pages.
// Usage: npm run site:preview   (after npm run site)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../_site");
const port = Number(process.env.PORT ?? 4173);
const base = "/LogicTrail";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("There is no built site yet. Run: npm run site");
  process.exit(1);
}

http
  .createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (!url.startsWith(`${base}/`)) {
      response.writeHead(302, { location: `${base}/` }).end();
      return;
    }
    let file = path.join(root, url.slice(base.length));
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      // Relative links need the slash, as on GitHub Pages: /claude → /claude/.
      if (!url.endsWith("/")) {
        response.writeHead(301, { location: `${url}/` }).end();
        return;
      }
      file = path.join(file, "index.html");
    }
    if (!fs.existsSync(file)) {
      response.writeHead(404, { "content-type": TYPES[".html"] });
      fs.createReadStream(path.join(root, "404.html")).pipe(response);
      return;
    }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Number(range[2]) : size - 1;
      response.writeHead(206, {
        "content-type": type,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": end - start + 1,
        "accept-ranges": "bytes",
      });
      fs.createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, {
      "content-type": type,
      "content-length": size,
      "accept-ranges": "bytes",
    });
    fs.createReadStream(file).pipe(response);
  })
  .listen(port, () => console.log(`LogicTrail site: http://localhost:${port}${base}/`));
