import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const id = () => randomBytes(24).toString('base64url');
const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
export function iceConfig(env = process.env, identity = id()) {
  const iceServers = [];
  const stun = (env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean);
  if (stun.length) iceServers.push({ urls: stun });
  if (env.TURN_URLS && env.TURN_SECRET) {
    const ttl = Math.max(60, Math.min(86400, Number(env.TURN_TTL_SECONDS) || 3600));
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${identity}`;
    iceServers.push({ urls: env.TURN_URLS.split(','), username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  }
  return { iceServers, turnConfigured: iceServers.some(s => s.credential), ttl: Number(env.TURN_TTL_SECONDS) || 3600 };
}

export function createDuoServer({ env = process.env, graceMs = 30000 } = {}) {
  const rooms = new Map();
  const origins = new Set((env.ALLOWED_ORIGINS || env.RENDER_EXTERNAL_URL || 'http://localhost:3210,http://127.0.0.1:3210').split(',').map(s => s.trim().replace(/\/$/, '')));
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), display-capture=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'");
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true })); }
    const file = files[req.url?.split('?')[0]];
    if (!file || req.method !== 'GET') { res.writeHead(404); return res.end('Não encontrado'); }
    try { const content = await readFile(new URL(`./public/${file[0]}`, import.meta.url)); res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }); res.end(content); }
    catch { res.writeHead(500); res.end('Falha ao carregar arquivo'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  const attempts = new Map();
  server.on('upgrade', (req, socket, head) => {
    const ip = req.socket.remoteAddress;
    const rate = attempts.get(ip) || { n: 0, time: Date.now() };
    if (Date.now() - rate.time > 60000) { rate.n = 0; rate.time = Date.now(); }
    rate.n++; attempts.set(ip, rate);
    if (req.url !== '/signal' || !origins.has(req.headers.origin) || rate.n > 60 || wss.clients.size >= 500) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  function roster(room) {
    const peers = [...room.members.values()].map(m => ({ id: m.id, name: m.name, online: !!m.ws, state: m.state }));
    for (const m of room.members.values()) send(m.ws, { type: 'roster', peers });
  }
  function remove(room, member) {
    clearTimeout(member.expire); room.members.delete(member.id);
    if (!room.members.size) rooms.delete(room.id); else roster(room);
  }
  wss.on('connection', ws => {
    let room, member, n = 0, windowStart = Date.now(), admissionAttempts = 0;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const admissionTimeout = setTimeout(() => { if (!member) ws.close(1008, 'Entre em uma sala'); }, 15000);
    ws.on('message', raw => {
      try {
        if (Date.now() - windowStart > 10000) { n = 0; windowStart = Date.now(); }
        if (++n > 160) return ws.close(1008, 'Muitas mensagens');
        const m = JSON.parse(raw);
        if (!member) {
          if (++admissionAttempts > 6) return ws.close(1008, 'Muitas tentativas');
          if (!['create', 'join'].includes(m.type) || typeof m.name !== 'string' || !m.name.trim()) throw Error('Informe seu apelido.');
          if (m.type === 'create') {
            if (rooms.size >= 200) throw Error('Servidor ocupado. Tente novamente.');
            room = { id: id(), members: new Map() }; rooms.set(room.id, room);
          } else { room = rooms.get(m.room); if (!room) throw Error('Sala não encontrada ou encerrada. Crie uma nova sala.'); }
          const prior = [...room.members.values()].find(p => p.token === m.token);
          if (prior) {
            clearTimeout(prior.expire); const old = prior.ws; member = prior; member.ws = ws; old?.close(4000, 'Sessão retomada');
          } else {
            if (room.members.size >= 2) throw Error('Esta sala já tem duas pessoas. Uma vaga desconectada fica reservada por 30 segundos.');
            member = { id: id(), token: id(), name: m.name.trim().slice(0, 32), ws, state: { muted: false, speaking: false, sharing: false } };
            room.members.set(member.id, member);
          }
          clearTimeout(admissionTimeout);
          send(ws, { type: 'joined', room: room.id, id: member.id, token: member.token, ...iceConfig(env, member.id) });
          roster(room); return;
        }
        if (m.type === 'leave') { remove(room, member); member = null; return ws.close(1000, 'Saiu'); }
        if (m.type === 'ice-config') return send(ws, { type: 'ice-config', ...iceConfig(env, member.id) });
        if (m.type === 'state') {
          member.state = { muted: !!m.muted, speaking: !!m.speaking, sharing: !!m.sharing }; roster(room); return;
        }
        if (m.type === 'chat') {
          if (typeof m.text !== 'string' || !m.text.trim()) return;
          const payload = { type: 'chat', from: member.id, name: member.name, text: m.text.trim().slice(0, 4000), time: Date.now() };
          for (const p of room.members.values()) send(p.ws, payload); return;
        }
        if (m.type === 'signal' && m.data && typeof m.data === 'object') {
          for (const p of room.members.values()) if (p.id !== member.id) send(p.ws, { type: 'signal', from: member.id, data: m.data });
        }
      } catch (err) { send(ws, { type: 'error', message: err instanceof SyntaxError ? 'Mensagem inválida.' : err.message }); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(admissionTimeout);
      if (!member || member.ws !== ws || !room.members.has(member.id)) return;
      member.ws = null; member.state.speaking = false; roster(room);
      member.expire = setTimeout(() => remove(room, member), graceMs);
    });
  });
  const pulse = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [ip, r] of attempts) if (Date.now() - r.time > 120000) attempts.delete(ip);
  }, 15000);
  pulse.unref();
  async function close() {
    clearInterval(pulse);
    for (const room of rooms.values()) for (const m of room.members.values()) clearTimeout(m.expire);
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
  return { server, close, rooms };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = createDuoServer();
  app.server.listen(Number(process.env.PORT) || 3210, process.env.HOST || '127.0.0.1', () => console.log(`dd: http://localhost:${process.env.PORT || 3210}`));
  process.on('SIGINT', async () => { await app.close(); process.exit(0); });
}
