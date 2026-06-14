import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = resolve(rootDir, "dist");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const backendTarget = new URL(process.env.BACKEND_URL || "http://127.0.0.1:8000");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isProxyPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/media" || pathname.startsWith("/media/");
}

function sendFile(res, filePath) {
  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });

  createReadStream(filePath).pipe(res);
}

function resolveStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname.split("?")[0]);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(distDir, normalizedPath));

  if (filePath !== distDir && !filePath.startsWith(distDir + sep)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }

  return null;
}

function proxyRequest(req, res) {
  const targetUrl = new URL(req.url || "/", backendTarget);
  const client = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = { ...req.headers, host: backendTarget.host };

  const proxy = client(
    targetUrl,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxy.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Backend proxy failed: ${err.message}`);
  });

  req.pipe(proxy);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (isProxyPath(url.pathname)) {
    proxyRequest(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const staticFile = resolveStaticPath(url.pathname);
  if (staticFile) {
    sendFile(res, staticFile);
    return;
  }

  sendFile(res, join(distDir, "index.html"));
});

server.listen(port, host, () => {
  console.log(`Serving ${distDir} at http://${host}:${port}`);
  console.log(`Proxying /api and /media to ${backendTarget.origin}`);
});
