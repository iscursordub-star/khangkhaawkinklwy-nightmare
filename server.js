const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080;

// 1. HTTP Server (โครงสร้างเดิมของคุณสำหรับเสิร์ฟ index.html)
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'index.html');

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end('Error loading index.html');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content, 'utf-8');
        }
    });
});

// 2. WebSocket Server ผูกเข้ากับ HTTP Server บนพอร์ต 8080
const wss = new WebSocket.Server({ server });

// ตัวแปรเก็บข้อมูลในหน่วยความจำของเซิร์ฟเวอร์
const players = new Map(); // เก็บข้อมูลผู้เล่น (id, ตำแหน่ง, มุมหมุน, สถานะ)
let leaderboard = [];      // เก็บสถิติ/คะแนนสูงสุด

// ฟังก์ชันส่งข้อมูลให้ผู้เล่นทุกคน (ยกเว้นคนส่ง ถ้ากำหนด excludeWs)
function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    // สร้าง ID สุ่มให้ผู้เล่นที่เพิ่งเข้ามา
    const playerId = 'player_' + Math.random().toString(36).substring(2, 9);
    
    // ตั้งค่าเริ่มต้นของผู้เล่น
    players.set(playerId, {
        id: playerId,
        name: `ผู้เล่น_${playerId.slice(-4)}`,
        x: 0,
        y: 1.6,
        z: 0,
        ry: 0
    });

    console.log(`[Connected] ${playerId} (ออนไลน์: ${players.size} คน)`);

    // ส่งข้อมูลเริ่มต้นกลับไปให้ผู้เล่นใหม่ (ID ของตัวเอง + รายชื่อผู้เล่นคนอื่น + Leaderboard)
    ws.send(JSON.stringify({
        type: 'INIT',
        id: playerId,
        players: Object.fromEntries(players),
        leaderboard: leaderboard
    }));

    // แจ้งผู้เล่นคนอื่นว่ามีคนเข้ามาใหม่
    broadcast({
        type: 'PLAYER_JOINED',
        player: players.get(playerId)
    }, ws);

    // รับข้อความและคำสั่งต่างๆ จากฝั่งเกม (Client)
    ws.on('message', (rawMessage) => {
        try {
            const data = JSON.parse(rawMessage);

            switch (data.type) {
                // 1. อัปเดตตำแหน่งและการหันหน้า (Multiplayer)
                case 'MOVE':
                    if (players.has(playerId)) {
                        const p = players.get(playerId);
                        p.x = data.x;
                        p.y = data.y;
                        p.z = data.z;
                        p.ry = data.ry;

                        broadcast({
                            type: 'PLAYER_MOVED',
                            id: playerId,
                            x: p.x,
                            y: p.y,
                            z: p.z,
                            ry: p.ry
                        }, ws);
                    }
                    break;

                // 2. ระบบแชทในเกม (Lobby / In-game Chat)
                case 'CHAT':
                    const sender = players.get(playerId);
                    broadcast({
                        type: 'CHAT_MESSAGE',
                        id: playerId,
                        name: data.name || (sender ? sender.name : playerId),
                        text: String(data.text).slice(0, 200) // จำกัดความยาวข้อความ
                    });
                    break;

                // 3. ระบบอัปเดตคะแนน / กระดานผู้นำ (Leaderboard)
                case 'SUBMIT_SCORE':
                    const playerName = data.name || players.get(playerId)?.name || playerId;
                    leaderboard.push({
                        name: playerName,
                        score: Number(data.score) || 0,
                        time: data.time || null
                    });
                    // เรียงคะแนนจากมากไปน้อย และเก็บแค่ 10 อันดับแรก
                    leaderboard.sort((a, b) => b.score - a.score);
                    leaderboard = leaderboard.slice(0, 10);

                    broadcast({
                        type: 'LEADERBOARD_UPDATE',
                        leaderboard: leaderboard
                    });
                    break;

                // 4. ซิงค์เหตุการณ์ในเกม (เช่น เปิดประตู, เก็บไอเทม, ผีโผล่)
                case 'GAME_EVENT':
                    broadcast({
                        type: 'GAME_EVENT',
                        id: playerId,
                        event: data.event,
                        payload: data.payload
                    }, ws);
                    break;
            }
        } catch (err) {
            console.error('[WS Error] รูปแบบข้อมูลไม่ถูกต้อง:', err.message);
        }
    });

    // เมื่อผู้เล่นปิดหน้าเว็บหรือหลุดการเชื่อมต่อ
    ws.on('close', () => {
        console.log(`[Disconnected] ${playerId}`);
        players.delete(playerId);
        broadcast({
            type: 'PLAYER_LEFT',
            id: playerId
        });
    });
});

// 3. เริ่มต้นรันเซิร์ฟเวอร์
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`WebSocket ready at ws://localhost:${PORT}/`);
});
