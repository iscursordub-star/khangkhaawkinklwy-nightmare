// กำหนด URL ของ WebSocket
const WS_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'ws://localhost:8080' // สำหรับรันเทสบนเครื่องตัวเอง
    : 'wss://https://khaangkhaawkinklwy-baanranaadphii.onrender.com'; // 👈 เปลี่ยนตรงนี้เป็น URL จริงที่ได้จาก Render Dashboard ของคุณ

let socket;
let isConnected = false;

function initMultiplayer() {
    console.log("กำลังเชื่อมต่อเซิร์ฟเวอร์มัลติเพลย์เยอร์...");
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        isConnected = true;
        console.log("เชื่อมต่อ WebSocket สำเร็จ!");
        
        // ซ่อนกล่องแจ้งเตือน "ออนไลน์ยังไม่พร้อม" ทันทีเมื่อต่อติด
        hideWarningBanner();
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    };

    socket.onclose = () => {
        isConnected = false;
        console.warn("การเชื่อมต่อหลุด กำลังลองเชื่อมต่อใหม่ใน 3 วินาที...");
        showWarningBanner();
        setTimeout(initMultiplayer, 3000);
    };

    socket.onerror = (error) => {
        console.error("WebSocket เกิดข้อผิดพลาด:", error);
    };
}

// ฟังก์ชันซ่อนแถบเตือนสีแดง
function hideWarningBanner() {
    // หา Element แถบเตือนตามโครงสร้างหน้าเว็บของคุณแล้วซ่อน
    const warningElements = document.querySelectorAll('div');
    warningElements.forEach(el => {
        if (el.textContent.includes('ออนไลน์ยังไม่พร้อม')) {
            el.style.display = 'none';
        }
    });
}

function showWarningBanner() {
    const warningElements = document.querySelectorAll('div');
    warningElements.forEach(el => {
        if (el.textContent.includes('ออนไลน์ยังไม่พร้อม')) {
            el.style.display = 'block';
        }
    });
}

// ส่งข้อมูลตำแหน่งหรือแอคชันของผู้เล่นไปยังเซิร์ฟเวอร์
function sendAction(actionData) {
    if (isConnected && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(actionData));
    }
}

function handleServerMessage(message) {
    // จัดการข้อมูลที่ได้รับจากเซิร์ฟเวอร์ (เช่น ตำแหน่งผู้เล่นอื่น)
    switch (message.type) {
        case 'SYNC_PLAYERS':
            // อัปเดตผู้เล่นคนอื่นในเกม 3D ของคุณ
            if (typeof updateOtherPlayers === 'function') {
                updateOtherPlayers(message.players);
            }
            break;
    }
}

// เริ่มต้นระบบ
window.addEventListener('DOMContentLoaded', () => {
    initMultiplayer();
});
