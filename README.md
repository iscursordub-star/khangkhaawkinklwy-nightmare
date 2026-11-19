## 📚 สารบัญเอกสารโปรเจกต์ / Project Documentation

### 🇹🇭 ภาษาไทย (Thai Version)
1. **[INFO.md](./INFO.md)** — หน้าหลักและข้อมูลภาพรวมของเกม (Main Overview)
2. **[IN-GAME.md](./IN-GAME.md)** — เนื้อเรื่อง ฉากเหตุการณ์ บทสนทนา และมินิเกม (Story, Events & Minigames)
3. **[WARNING.md](./WARNING.md)** — คำเตือนเนื้อหาสยองขวัญและข้อควรระวังด้าน FPS (Content & FPS Warning)

### 🇬🇧 English Version
4. **[INFOENG.md](./INFOENG.md)** — Main Overview & Controls
5. **[IN-GAMEENG.md](./IN-GAMEENG.md)** — Story, Events & Minigames
6. **[WARNINGENG.md](./WARNINGENG.md)** — Content & Performance Warning

👉 **ไปต่อไฟล์ถัดไป / Next File:** [INFO.md](./INFO.md)
---
# ค้าวคาวกินกล้วย — บ้านระนาดผี
## ปรับแต่งปุ่มในเกม (Button Styles & JS)

### CSS (วางใน `<style>...</style>`)
```css
button {
  position: relative;
  font: inherit;
  color: #f7f1e5;
  background: linear-gradient(180deg, rgba(165, 22, 34, 0.88) 0%, rgba(85, 8, 15, 0.95) 100%);
  border: 1px solid rgba(255, 110, 110, 0.45);
  border-bottom: 3px solid #3b0409;
  border-radius: 12px;
  padding: 12px 16px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9);
  transition: transform 0.12s ease, box-shadow 0.18s ease, filter 0.18s ease, border-color 0.18s ease;
}

button:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: var(--gold);
  box-shadow: 0 6px 20px rgba(179, 32, 42, 0.55), 0 0 12px rgba(217, 179, 106, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.28);
  filter: brightness(1.08);
}

button:active:not(:disabled) {
  transform: translateY(1px) scale(0.98);
  border-bottom-width: 1px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.8), inset 0 2px 6px rgba(0, 0, 0, 0.5);
}

button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  filter: grayscale(0.4);
}

#go {
  font-size: 19px;
  font-weight: 700;
  text-align: center;
  background: linear-gradient(180deg, #d62839 0%, #7d111b 100%);
  border: 1px solid var(--gold);
  border-bottom: 4px solid #3d050a;
  box-shadow: 0 0 18px rgba(214, 40, 57, 0.55), 0 6px 16px rgba(0, 0, 0, 0.75);
  animation: gameBtnPulse 2.2s infinite ease-in-out;
}

@keyframes gameBtnPulse {
  0%, 100% { box-shadow: 0 0 14px rgba(214, 40, 57, 0.45), 0 6px 16px rgba(0, 0, 0, 0.75); }
  50% { box-shadow: 0 0 24px rgba(217, 179, 106, 0.55), 0 6px 18px rgba(0, 0, 0, 0.85); }
}

#fire {
  background: linear-gradient(180deg, #ff3b3b 0%, #990f1d 100%);
  border: 2px solid #ffb3b3;
  border-bottom: 4px solid #4a040b;
  box-shadow: 0 0 20px rgba(255, 59, 59, 0.65);
}

#act {
  background: linear-gradient(180deg, rgba(217, 179, 106, 0.92) 0%, rgba(130, 88, 24, 0.95) 100%);
  color: #140d04;
  border: 1px solid #fff0c2;
  border-bottom: 3px solid #472d07;
  text-shadow: none;
  box-shadow: 0 0 16px rgba(217, 179, 106, 0.5);
}

.btn-alert {
  border-color: #ffd24a !important;
  box-shadow: 0 0 20px rgba(255, 210, 74, 0.85) !important;
}
```

### JavaScript (วางใน `<script>...</script>`)
```javascript
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;

  if (typeof tone === 'function') {
    try {
      tone(btn.id === 'go' ? 420 : 320, 0.06, 'triangle', 0.06);
    } catch (_) {}
  }
}, { passive: true });

function highlightButton(id, duration = 1200) {
  const el = $(id);
  if (!el) return;
  el.classList.add('btn-alert');
  setTimeout(() => el.classList.remove('btn-alert'), duration);
}

const actEl = $('act');
if (actEl) {
  const actObs = new MutationObserver(() => {
    if (getComputedStyle(actEl).display !== 'none') {
      highlightButton('act', 900);
    }
  });
  actObs.observe(actEl, { attributes: true, attributeFilter: ['style', 'class'] });
}
```
**[กลับเข้าสู่เกมอีกครั้ง / Go back to the Game]** [Go Back](https://khaangkhaawkinklwy-baanranaadphii.onrender.com/)
