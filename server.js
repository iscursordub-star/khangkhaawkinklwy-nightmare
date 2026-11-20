// server.js — เซิร์ฟเวอร์เกม "ค้างคาวกินกล้วย"
// เสิร์ฟหน้าเกม (index.html) + WebSocket มัลติเพลเยอร์ (ห้องสาธารณะ/ส่วนตัว, เตะผู้เล่น, ค้นหาห้อง)
// รันบน Render: Build = npm install, Start = npm start
//
// ตัวแปรสภาพแวดล้อม (ไม่บังคับ):
//   SERVER_NAME  ชื่อเซิร์ฟเวอร์นี้ที่แสดงในผลค้นหา เช่น "สิงคโปร์"
//   SERVER_LIST  JSON รายชื่อเซิร์ฟเวอร์เพื่อนบ้านให้ผู้เล่นค้นหา เช่น
//                [{"name":"โตเกียว","url":"wss://tokyo.onrender.com/ws"}]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PEERS = 8;          // ผู้เล่นสูงสุดต่อห้อง
const MAX_PRESENCE = 4096;    // ขนาดข้อมูลสถานะต่อผู้เล่น (ไบต์)
const SERVER_NAME = process.env.SERVER_NAME || 'เซิร์ฟเวอร์หลัก';
let SERVER_LIST = [];
try { SERVER_LIST = JSON.parse(process.env.SERVER_LIST || '[]'); } catch (e) { SERVER_LIST = []; }
const INDEX = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/servers') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(SERVER_LIST));
  }
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
// ชื่อห้อง -> { peers: Map(id -> {ws, p, cid}), host: id, pub: bool, meta: {}, banned: Set(cid) }
const rooms = new Map();

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = (room, o, exceptId) => { for (const [id, c] of room.peers) if (id !== exceptId) send(c.ws, o); };
const cleanMeta = (x) => {
  x = x || {};
  return {
    name: String(x.name || '').slice(0, 40),
    ch: String(x.ch || '').slice(0, 8),
    started: !!x.started,
    bots: Math.max(0, Math.min(3, +x.bots || 0)),
  };
};
const roomInfo = (name, r) => ({
  room: name,
  name: r.meta.name || 'ห้องผู้เล่น',
  players: r.peers.size,
  max: MAX_PEERS,
  ch: r.meta.ch || '',
  started: !!r.meta.started,
  bots: r.meta.bots || 0,
});

wss.on('connection', (ws) => {
  let room = null, id = null, roomName = null;
  let count = 0, windowStart = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 60) return;                         // กันสแปม: 60 ข้อความ/วินาที
    let m; try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'list') {                             // ค้นหาห้องสาธารณะ (ไม่ต้องเข้าห้อง)
      const list = [];
      for (const [n, r] of rooms) if (r.pub && r.peers.size < MAX_PEERS) list.push(roomInfo(n, r));
      return send(ws, { t: 'rooms', name: SERVER_NAME, list });
    }

    if (m.t === 'join' && !room) {
      const name = String(m.room || '');
      if (!/^[a-z0-9-]{1,32}$/.test(name)) return send(ws, { t: 'err', code: 'badroom' });
      const cid = String(m.cid || '').slice(0, 24);
      let r = rooms.get(name);
      if (!r) {
        if (!m.host) return send(ws, { t: 'err', code: 'noroom' });   // ห้องต้องถูกสร้างโดย Host
        r = { peers: new Map(), host: null, pub: !!m.pub, meta: cleanMeta(m.meta), banned: new Set() };
        rooms.set(name, r);
        r.hostPending = true;
      }
      if (r.banned.has(cid)) return send(ws, { t: 'err', code: 'banned' });
      if (r.peers.size >= MAX_PEERS) return send(ws, { t: 'err', code: 'full' });
      id = Math.random().toString(36).slice(2, 8);
      room = r; roomName = name;
      r.peers.set(id, { ws, p: {}, cid });
      if (r.hostPending) { r.host = id; r.hostPending = false; }
      send(ws, { t: 'snap', id, list: [...r.peers].map(([k, c]) => ({ peer: k, p: c.p })) });
      broadcast(r, { t: 'p', peer: id, p: {} }, id);
    } else if (m.t === 'p' && room) {
      if (!m.p || typeof m.p !== 'object') return;
      const c = room.peers.get(id);
      const merged = Object.assign({}, c.p, m.p);
      if (JSON.stringify(merged).length > MAX_PRESENCE) return;
      c.p = merged;
      broadcast(room, { t: 'p', peer: id, p: m.p }, id);
    } else if (m.t === 'meta' && room && room.host === id) {          // Host เปลี่ยนสาธารณะ/ส่วนตัว + ข้อมูลห้อง
      room.pub = !!m.pub;
      room.meta = cleanMeta(m.meta);
    } else if (m.t === 'kick' && room && room.host === id) {          // Host เตะผู้เล่นออกจากห้อง
      const target = String(m.peer || '');
      const t = room.peers.get(target);
      if (t && target !== id) {
        room.banned.add(t.cid);                                       // กันกลับเข้าห้องเดิม
        send(t.ws, { t: 'kicked' });
        try { t.ws.close(); } catch (e) {}
      }
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong' });
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.peers.delete(id);
    if (room.host === id) {                                           // Host ออก = ปิดห้อง
      for (const [, c] of room.peers) { send(c.ws, { t: 'closed' }); try { c.ws.close(); } catch (e) {} }
      rooms.delete(roomName);
    } else {
      broadcast(room, { t: 'left', peer: id });
    }
  });
});

// ping ทุก 25 วินาที กัน proxy ของ Render ตัดการเชื่อมต่อที่เงียบ
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);


const { spawn } = require('child_process');
const rsBin = path.join(__dirname, 'server-rs', 'target', 'release', 'bat-banana-ws-rs');
if (fs.existsSync(rsBin)) {
  const rsProc = spawn(rsBin, [], {
    env: { ...process.env, RS_PORT: process.env.RS_PORT || '4000' },
    stdio: 'inherit',
  });
  rsProc.on('exit', (code) => console.log('Rust process exited with code:', code));
}

server.listen(PORT, () => console.log('Server "' + SERVER_NAME + '" listening on port ' + PORT));
