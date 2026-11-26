// Formas de onda: pirâmide de picos pré-calculada + desenho apenas da janela visível.

export const BUCKET = 128;

export function computePeaks(data) {
  const len = data[0].length, n = Math.ceil(len / BUCKET);
  const min = new Float32Array(n), max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = 0, hi = 0; const s = b * BUCKET, e = Math.min(len, s + BUCKET);
    for (let i = s; i < e; i++) {
      const v = (data[0][i] + data[1][i]) * 0.5;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    min[b] = lo; max[b] = hi;
  }
  return { min, max };
}

/** Desenha a janela [viewStart, viewStart + width/pxPerSec] em segundos. */
export function drawWave(canvas, peaks, rate, viewStart, pxPerSec, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const mid = h / 2;
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, mid, w, 1);
  g.fillStyle = color;
  const samplesPerPx = rate / pxPerSec;
  for (let x = 0; x < w; x++) {
    const s0 = (viewStart * rate) + x * samplesPerPx, s1 = s0 + samplesPerPx;
    let b0 = Math.floor(s0 / BUCKET), b1 = Math.max(b0 + 1, Math.ceil(s1 / BUCKET));
    if (b0 >= peaks.min.length) break; if (b1 > peaks.min.length) b1 = peaks.min.length;
    let lo = 0, hi = 0;
    for (let b = Math.max(0, b0); b < b1; b++) { if (peaks.min[b] < lo) lo = peaks.min[b]; if (peaks.max[b] > hi) hi = peaks.max[b]; }
    const y0 = mid - Math.min(1, hi) * (mid - 2), y1 = mid - Math.max(-1, lo) * (mid - 2);
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

export function drawRuler(canvas, viewStart, pxPerSec, duration) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(s => s * pxPerSec >= 70) || 600;
  g.font = '11px ui-monospace, monospace'; g.fillStyle = '#7d9a9a'; g.strokeStyle = '#27393b';
  for (let t = Math.ceil(viewStart / step) * step; t <= Math.min(duration, viewStart + w / pxPerSec); t += step) {
    const x = Math.round((t - viewStart) * pxPerSec) + 0.5;
    g.beginPath(); g.moveTo(x, h - 8); g.lineTo(x, h); g.stroke();
    g.fillText(fmtTime(t, step < 1), x + 4, h - 10);
  }
}

export function fmtTime(t, frac = false) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${(frac ? s.toFixed(2) : Math.floor(s).toString()).padStart(frac ? 5 : 2, '0')}`;
}
