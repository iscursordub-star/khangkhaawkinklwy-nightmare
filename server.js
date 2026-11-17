const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { exec } = require('child_process'); // ใช้สำหรับสั่งเปิดเบราว์เซอร์

const PORT = process.env.PORT || 8080;

// 1. สร้าง HTTP Server เพื่อเสิร์ฟไฟล์หน้าเว็บ (HTML และ Client.js)
const server = http.createServer((req, res) => {
    // ถ้าเข้าหน้าแรก ให้โหลดไฟล์ index.html
    let filePath = req.url === '/' ? './index.html' : '.' + req.url;
    let extname = path.extname(filePath);
    let contentType = 'text/html';

    // กำหนด Content-Type ให้ถูกต้องตามประเภทไฟล์
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
    }

    // อ่านและส่งไฟล์ไปแสดงบนเบราว์เซอร์
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if(error.code == 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h2>ไม่พบไฟล์ที่คุณต้องการ (404)</h2>');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// 2. ผูกระบบ WebSocket เข้ากับ HTTP Server ตัวเดียวกัน
const wss = new WebSocket.Server({ server });

let players = {};

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);
    console.log(`[Connected] ผู้เล่นเข้าสู่ระบบ: ${playerId}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            players[playerId] = data;

            // ส่งข้อมูลอัปเดตให้ทุกคน
            const payload = JSON.stringify({ type: 'SYNC_PLAYERS', players });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            });
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    });

    ws.on('close', () => {
        delete players[playerId];
        console.log(`[Disconnected] ผู้เล่นออกจากระบบ: ${playerId}`);
        
        const payload = JSON.stringify({ type: 'SYNC_PLAYERS', players });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    });
});

// 3. เริ่มรัน Server และ "สั่งเปิด Browser อัตโนมัติ"
server.listen(PORT, () => {
    const serverUrl = `http://localhost:${PORT}`;
    console.log(`🚀 เซิร์ฟเวอร์กำลังรันอยู่ที่: ${serverUrl}`);

    // คำสั่งเปิดเบราว์เซอร์อัตโนมัติ (รองรับทั้ง Windows, Mac, Linux)
    const startCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCommand} ${serverUrl}`);
});
