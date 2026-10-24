// 本機一鍵啟動：靜態前端（只綁 127.0.0.1）+ wrangler dev（Worker）
// 用法：npm run dev   → 開 http://127.0.0.1:5173
// 靜態伺服器只提供 index.html、backtest/、data/，其他路徑（含 worker/.dev.vars）一律 404。

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const WEB_PORT = Number(process.env.WEB_PORT || 5173);
const WORKER_PORT = Number(process.env.WORKER_PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function resolvePublicPath(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith('..') || normalized.split('/').some(part => part.startsWith('.'))) return null;
  const allowed = normalized === 'index.html' || /^(backtest|data)\/[^/]+$/.test(normalized);
  return allowed ? path.join(ROOT, normalized) : null;
}

const server = http.createServer(async (req, res) => {
  const file = resolvePublicPath(req.url);
  try {
    if (!file || !(await stat(file)).isFile()) throw new Error('not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(WEB_PORT, HOST, () => {
  console.log(`\n▶ 前端：http://${HOST}:${WEB_PORT}  （只接受本機連線）`);
  console.log(`▶ Worker：http://${HOST}:${WORKER_PORT}  （wrangler dev 啟動中…）`);
  console.log('  按 Ctrl+C 同時停止兩者\n');
});

const require = createRequire(import.meta.url);
const wranglerPkgPath = require.resolve('wrangler/package.json');
const wranglerPkg = require(wranglerPkgPath);
const wranglerBin = path.join(path.dirname(wranglerPkgPath), typeof wranglerPkg.bin === 'string' ? wranglerPkg.bin : wranglerPkg.bin.wrangler);

const worker = spawn(process.execPath, [wranglerBin, 'dev', '--ip', HOST, '--port', String(WORKER_PORT)], {
  cwd: path.join(ROOT, 'worker'),
  stdio: 'inherit'
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.close();
  if (worker.exitCode === null) worker.kill();
  setTimeout(() => process.exit(code), 500);
}

worker.on('exit', code => {
  if (!stopping) console.log(`wrangler dev 已結束（${code}），一併關閉前端`);
  stop(code ?? 0);
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
