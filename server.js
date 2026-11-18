// server.js — เซิร์ฟเวอร์เกม "ค้างคาวกินกล้วย" (เสิร์ฟหน้าเว็บ + WebSocket มัลติเพลเยอร์)
// รันบน Render: Build = npm install, Start = npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PEERS = 8;          // ผู้เล่นสูงสุดต่อห้อง
const MAX_PRESENCE = 4096;    // ขนาดข้อมูลสถานะต่อผู้เล่น (ไบต์)
const INDEX = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    return fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
const rooms = new Map(); // ชื่อห้อง -> Map(peerId -> { ws, p })

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = (room, o, exceptId) => { for (const [id, c] of room) if (id !== exceptId) send(c.ws, o); };

wss.on('connection', (ws) => {
  let room = null, id = null, roomName = null;
  let count = 0, windowStart = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 60) return;                        // กันสแปม: 60 ข้อความ/วินาที
    let m; try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'join' && !room) {
      const name = String(m.room || '');
      if (!/^[a-z0-9-]{1,32}$/.test(name)) return send(ws, { t: 'err', code: 'badroom' });
      let r = rooms.get(name);
      if (!r) { r = new Map(); rooms.set(name, r); }
      if (r.size >= MAX_PEERS) return send(ws, { t: 'err', code: 'full' });
      id = Math.random().toString(36).slice(2, 8);
      room = r; roomName = name;
      r.set(id, { ws, p: {} });
      send(ws, { t: 'snap', id, list: [...r].map(([k, c]) => ({ peer: k, p: c.p })) });
      broadcast(r, { t: 'p', peer: id, p: {} }, id);
    } else if (m.t === 'p' && room) {
      if (!m.p || typeof m.p !== 'object') return;
      const c = room.get(id);
      const merged = Object.assign({}, c.p, m.p);
      if (JSON.stringify(merged).length > MAX_PRESENCE) return;
      c.p = merged;
      broadcast(room, { t: 'p', peer: id, p: m.p }, id);
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong' });
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.delete(id);
    broadcast(room, { t: 'left', peer: id });
    if (!room.size) rooms.delete(roomName);
  });
});

// ping ทุก 25 วินาที กัน proxy ของ Render ตัดการเชื่อมต่อที่เงียบ
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);

server.listen(PORT, () => console.log('Server listening on port ' + PORT));
