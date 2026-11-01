import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { WebSocket } from 'ws';
import { createDuoServer, iceConfig } from '../server.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function fixture(t) {
  const app = createDuoServer({ env: { ALLOWED_ORIGINS: 'http://localhost', STUN_URLS: '' }, graceMs: 100 });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => app.close()); return { ...app, port: app.server.address().port };
}
async function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/signal`, { origin: 'http://localhost' });
  const queue = []; ws.on('message', data => queue.push(JSON.parse(data)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, send: data => ws.send(JSON.stringify(data)), next: async type => { for (let i = 0; i < 200; i++) { const index = queue.findIndex(m => m.type === type); if (index >= 0) return queue.splice(index, 1)[0]; await delay(10); } throw Error(`Timeout: ${type}`); } };
}
test('private room, two-person limit, relay, escaped-as-data chat and leave', async t => {
  const { port } = await fixture(t), a = await client(port), b = await client(port), c = await client(port);
  a.send({ type: 'create', name: 'Victor' }); const first = await a.next('joined'); assert.match(first.room, /^[\w-]{32}$/);
  b.send({ type: 'join', room: first.room, name: 'Amigo' }); const second = await b.next('joined'); assert.notEqual(first.id, second.id);
  c.send({ type: 'join', room: first.room, name: 'Terceiro' }); assert.match((await c.next('error')).message, /duas pessoas/);
  a.send({ type: 'signal', data: { candidate: { candidate: 'test' } }, from: 'spoof' }); assert.equal((await b.next('signal')).from, first.id);
  b.send({ type: 'chat', text: '<script>alert(1)</script>', name: 'spoof' }); const chat = await a.next('chat'); assert.equal(chat.name, 'Amigo'); assert.equal(chat.text, '<script>alert(1)</script>');
  b.send({ type: 'leave' }); await delay(20); c.send({ type: 'join', room: first.room, name: 'Novo' }); assert.equal((await c.next('joined')).room, first.room);
});
test('reservation, reconnect token, and expiration', async t => {
  const { port, rooms } = await fixture(t), a = await client(port), b = await client(port);
  a.send({ type: 'create', name: 'A' }); const first = await a.next('joined');
  b.send({ type: 'join', room: first.room, name: 'B' }); await b.next('joined'); a.ws.close(); await delay(20);
  const c = await client(port); c.send({ type: 'join', room: first.room, name: 'C' }); assert.match((await c.next('error')).message, /duas pessoas/);
  c.send({ type: 'join', room: first.room, name: 'A', token: first.token }); const resumed = await c.next('joined'); assert.equal(resumed.id, first.id);
  c.ws.close(); b.ws.close(); await delay(160); assert.equal(rooms.size, 0);
});
test('TURN uses expiring HMAC credentials, never the permanent secret', () => {
  const env = { TURN_URLS: 'turn:example.org:3478,turns:example.org:5349', TURN_SECRET: 'unit-test-only-secret', TURN_TTL_SECONDS: '600', STUN_URLS: '' };
  const config = iceConfig(env, 'member'); const turn = config.iceServers[0];
  assert.equal(config.turnConfigured, true); assert.equal(turn.credential, createHmac('sha1', env.TURN_SECRET).update(turn.username).digest('base64'));
  assert.ok(+turn.username.split(':')[0] > Date.now() / 1000); assert.ok(!JSON.stringify(config).includes(env.TURN_SECRET));
});
test('rejects unapproved websocket origin and does not expose source files', async t => {
  const { port } = await fixture(t);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/signal`, { origin: 'https://unapproved.invalid' });
  const error = await new Promise(resolve => ws.once('error', resolve)); assert.match(error.message, /403/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/.env`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});
