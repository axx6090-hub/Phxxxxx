// A short two-tone "payment went through" beep, like tapping a card on a POS reader, for the moment the order capsule opens.
// Made with Web Audio (no sound file, nothing copied from anywhere). Browsers only allow
// sound after a tap, so unlockChime() is called inside the tap itself and playChime() later.
// If sound is blocked or not supported, nothing happens and nothing breaks.
let ctx = null;

export const unlockChime = () => {
  try {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    // a silent blip so iOS fully opens the audio channel during the tap
    const g = ctx.createGain();
    g.gain.value = 0;
    const o = ctx.createOscillator();
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
  } catch (e) { /* no sound, that's fine */ }
};

const tone = (freq, at, peak) => {
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
  out.connect(ctx.__chimeBus);
  [[freq, 1], [freq * 2, 0.22], [freq * 3, 0.06]].forEach(([f, level]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f, at);
    g.gain.value = level;
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.36);
  });
};

export const playChime = () => {
  try {
    if (!ctx || ctx.state !== "running") return; // blocked or never unlocked: stay quiet
    if (!ctx.__chimeBus) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6000;
      lp.connect(ctx.destination);
      ctx.__chimeBus = lp;
    }
    const t = ctx.currentTime + 0.01;
    tone(1318.5, t, 0.16);        // E6
    tone(1760, t + 0.085, 0.14);  // A6, just after: the rising "ding-ding"
  } catch (e) { /* ignore */ }
};
