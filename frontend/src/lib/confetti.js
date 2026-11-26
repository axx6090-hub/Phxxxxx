// Rose-petal cannons: red and pink petals shot from the left and right of the screen,
// then drifting down like petals. Plain canvas, no library, removes itself when done.
const COLORS = ["#9f1239", "#be123c", "#e11d48", "#f43f5e", "#fb7185", "#ec4899", "#f472b6", "#fda4af", "#c81e5a"];

const drawPetal = (ctx, size, color) => {
  // a rose petal: round top, narrowing to the base, with a soft notch on top
  const w = size * 0.8;
  const h = size;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.bezierCurveTo(-w * 0.9, h * 0.15, -w * 0.7, -h * 0.55, -w * 0.12, -h * 0.48);
  ctx.quadraticCurveTo(0, -h * 0.36, w * 0.12, -h * 0.48);
  ctx.bezierCurveTo(w * 0.7, -h * 0.55, w * 0.9, h * 0.15, 0, h / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(255,255,255,0.55)");
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = g;
  ctx.globalAlpha *= 0.35;
  ctx.fill();
};

export const firePetals = ({ pieces = 70, duration = 4200, from = "sides" } = {}) => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) { /* ignore */ }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const speed = Math.max(W, H) / 50;
  const parts = [];
  const cannon = (fromLeft, delay) => {
    for (let i = 0; i < pieces; i++) {
      // the cannon points up and in, toward the middle of the screen
      const angle = (fromLeft ? -58 : -122) + (Math.random() - 0.5) * 36;
      const rad = (angle * Math.PI) / 180;
      const v = speed * (0.6 + Math.random() * 0.55);
      parts.push({
        born: delay + Math.random() * 120,
        x: fromLeft ? -8 : W + 8,
        y: H * 0.78,
        vx: Math.cos(rad) * v,
        vy: Math.sin(rad) * v,
        size: 12 + Math.random() * 12,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.12,
        flip: Math.random() * Math.PI * 2,
        vflip: 0.05 + Math.random() * 0.08,
        sway: Math.random() * Math.PI * 2,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
  };
  const burst = () => {
    // the capsule opens in the middle of the screen: petals fly out all around, mostly up
    for (let i = 0; i < pieces * 2; i++) {
      const angle = -90 + (Math.random() - 0.5) * 300;
      const rad = (angle * Math.PI) / 180;
      const v = speed * (0.35 + Math.random() * 0.6);
      parts.push({
        born: Math.random() * 90,
        x: W / 2 + (Math.random() - 0.5) * 30,
        y: H / 2 + (Math.random() - 0.5) * 16,
        vx: Math.cos(rad) * v,
        vy: Math.sin(rad) * v,
        size: 12 + Math.random() * 13,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.12,
        flip: Math.random() * Math.PI * 2,
        vflip: 0.05 + Math.random() * 0.08,
        sway: Math.random() * Math.PI * 2,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
  };
  if (from === "center") burst();
  else { cannon(true, 0); cannon(false, 90); }

  const start = performance.now();
  let last = start;
  const tick = (now) => {
    const dt = Math.min(2, (now - last) / 16.7);
    last = now;
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    const fade = t > duration - 800 ? Math.max(0, (duration - t) / 800) : 1;
    for (const p of parts) {
      if (t < p.born) continue;
      // strong air drag: petals fly out fast, then float and flutter down
      p.vx *= Math.pow(0.965, dt);
      p.vy = p.vy * Math.pow(0.965, dt) + 0.16 * dt;
      if (p.vy > 2.6) p.vy = 2.6;
      p.sway += 0.06 * dt;
      p.x += (p.vx + Math.sin(p.sway) * 0.9) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vflip * dt;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.flip)));
      drawPetal(ctx, p.size, p.color);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
};
