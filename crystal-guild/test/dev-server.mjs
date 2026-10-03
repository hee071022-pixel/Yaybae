// netlify-cli 없이 로컬에서 확인용: node test/dev-server.mjs  → http://localhost:8888
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { respond } from '../netlify/functions/api.mjs';

process.env.ADMIN_PASSWORD ||= 'admin1234';
const root = new URL('../public/', import.meta.url).pathname;
const dataDir = new URL('../.local-blobs/', import.meta.url).pathname;
await mkdir(dataDir, { recursive: true });
const blobs = new BlobsServer({ directory: dataDir, token: 'local' });
const { port: bport } = await blobs.start();
const edge = `http://localhost:${bport}`;
const store = getStore({ name: 'crystal-guild', siteID: 'local', token: 'local', edgeURL: edge, uncachedEdgeURL: edge, consistency: 'strong' });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await respond(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), store);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8888, () => console.log(`http://localhost:8888  (운영자 비밀번호: ${process.env.ADMIN_PASSWORD})`));
