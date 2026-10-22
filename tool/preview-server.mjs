#!/usr/bin/env node
/**
 * Local preview for /tool and /tool/music.
 *
 * Required:
 *   API   http://127.0.0.1:3000
 *   Web   http://127.0.0.1:5173/tool/music/  (VITE_BASE=/tool/music/)
 *
 * Then run: node tool/preview-server.mjs
 */
import http from 'node:http';
import net from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.TOOLHUB_PORT || 4173);
const dukou = new URL(process.env.DUKOU_ORIGIN || 'http://127.0.0.1:5173');
const dukouPort = Number(dukou.port || 80);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendText(res, status, message) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(message);
}

function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  if (pathname === '/') {
    res.writeHead(302, { location: '/tool/' });
    res.end();
    return;
  }
  if (pathname === '/tool') {
    res.writeHead(302, { location: '/tool/' });
    res.end();
    return;
  }
  if (!pathname.startsWith('/tool/')) {
    sendText(res, 404, 'Not found');
    return;
  }

  const relative = pathname.slice('/tool/'.length) || 'index.html';
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

function proxyHttp(req, res) {
  const upstream = http.request(
    {
      hostname: dukou.hostname,
      port: dukouPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: dukou.host },
    },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      sendText(
        res,
        502,
        'Dukou dev server is not running on ' + dukou.origin,
      );
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  if (!req.url?.startsWith('/tool/music')) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(dukouPort, dukou.hostname, () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    upstream.write('\r\n');
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/tool/music')) {
    proxyHttp(req, res);
    return;
  }
  serveStatic(req, res);
});

server.on('upgrade', proxyUpgrade);
server.listen(port, '127.0.0.1', () => {
  console.log(`Tool hub:  http://127.0.0.1:${port}/tool/`);
  console.log(`Dukou:     http://127.0.0.1:${port}/tool/music/`);
  console.log(`Proxy to:  ${dukou.origin}`);
});
