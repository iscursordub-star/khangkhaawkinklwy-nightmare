const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let players = {};

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);
    console.log(`[Connected] ผู้เล่นเข้าสู่ระบบ: ${playerId}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // บันทึกข้อมูลตำแหน่ง/สถานะของผู้เล่นคนนี้
            players[playerId] = data;

            // กระจายข้อมูลผู้เล่นทุกคนไปยังไคลเอนต์อื่นๆ ทั้งหมด
            const payload = JSON.stringify({
                type: 'SYNC_PLAYERS',
                players: players
            });

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
        
        // แจ้งเตือนผู้เล่นที่เหลือว่ามีคนออก
        const payload = JSON.stringify({
            type: 'SYNC_PLAYERS',
            players: players
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    });
});

console.log(`WebSocket Server กำลังรันอยู่ที่พอร์ต ${PORT}`);
