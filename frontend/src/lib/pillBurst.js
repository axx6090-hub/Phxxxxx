// Order celebration: a glossy green-and-white capsule flies to the middle of the screen,
// splits open and throws out red and pink rose petals. Plain DOM + Web Animations, no assets.
import { firePetals } from "./confetti";

const el = (style, parent) => {
  const d = document.createElement("div");
  d.style.cssText = style;
  if (parent) parent.appendChild(d);
  return d;
};

const anim = (node, frames, opts) => new Promise((resolve) => {
  if (!node.animate) { resolve(); return; }
  const a = node.animate(frames, { fill: "forwards", ...opts });
  a.onfinish = resolve;
  a.oncancel = resolve;
});

export const playOrderCelebration = async () => {
  if (typeof document === "undefined") return;
  let reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* ignore */ }
  if (reduced || !document.body.animate) { firePetals({ from: "center" }); return; }

  const W = Math.min(window.innerWidth * 0.62, 300);
  const H = Math.round(W * 0.36);
  const overlay = el("position:fixed;inset:0;z-index:9998;pointer-events:none;background:rgba(255,241,246,0.82);display:flex;align-items:center;justify-content:center", document.body);
  overlay.setAttribute("aria-hidden", "true");
  // the capsule is tilted like the reference picture
  const pill = el(`position:relative;width:${W}px;height:${H}px;transform:rotate(-22deg);filter:drop-shadow(0 14px 18px rgba(0,0,0,.22))`, overlay);
  const half = (left) => {
    const h = el(`position:absolute;top:0;${left ? "left" : "right"}:0;width:50.5%;height:100%;overflow:hidden;`
      + `border-radius:${left ? `${H / 2}px 0 0 ${H / 2}px` : `0 ${H / 2}px ${H / 2}px 0`};`
      + (left
        ? "background:linear-gradient(180deg,#7fdc86 0%,#43a94c 38%,#2f8a38 72%,#1f6527 100%);"
        : "background:linear-gradient(180deg,#ffffff 0%,#f4f5f6 40%,#d9dde1 78%,#b9bfc5 100%);"), pill);
    // shine along the top of each half
    el(`position:absolute;top:${H * 0.12}px;${left ? `left:${H * 0.45}px;right:${H * 0.15}px` : `left:${H * 0.12}px;right:${H * 0.45}px`};height:${H * 0.17}px;border-radius:999px;background:rgba(255,255,255,${left ? 0.85 : 0.95});filter:blur(${Math.max(2, H * 0.04)}px)`, h);
    // soft edge where the halves meet
    el(`position:absolute;top:0;bottom:0;${left ? "right" : "left"}:0;width:${H * 0.1}px;background:linear-gradient(${left ? "90deg" : "270deg"},rgba(0,0,0,0),rgba(0,0,0,.12))`, h);
    return h;
  };
  const green = half(true);
  const white = half(false);

  try {
    // 1) flies in from the bottom right and settles in the middle
    await anim(pill, [
      { transform: "translate(55vw,60vh) rotate(40deg) scale(.35)", opacity: 0 },
      { transform: "translate(0,0) rotate(-28deg) scale(1.08)", opacity: 1, offset: 0.8 },
      { transform: "translate(0,0) rotate(-22deg) scale(1)", opacity: 1 },
    ], { duration: 650, easing: "cubic-bezier(.2,.8,.25,1)" });
    // 2) a little shake before it opens
    await anim(pill, [
      { transform: "rotate(-22deg) scale(1)" },
      { transform: "rotate(-17deg) scale(1.04)" },
      { transform: "rotate(-27deg) scale(1.04)" },
      { transform: "rotate(-22deg) scale(1.06)" },
    ], { duration: 260, easing: "ease-in-out" });
    // 3) it opens: the halves fly apart and the petals burst out
    firePetals({ from: "center", pieces: 75, duration: 4000 });
    const open = { duration: 560, easing: "cubic-bezier(.3,.7,.3,1)" };
    anim(overlay, [{ backgroundColor: "rgba(255,241,246,0.82)" }, { backgroundColor: "rgba(255,241,246,0)" }], { duration: 700, easing: "ease-out" });
    await Promise.all([
      anim(green, [{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(-${W * 0.9}px,${H * 0.6}px) rotate(-35deg)`, opacity: 0 }], open),
      anim(white, [{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${W * 0.9}px,-${H * 0.6}px) rotate(35deg)`, opacity: 0 }], open),
    ]);
  } finally {
    overlay.remove();
  }
};
