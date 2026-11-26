// Análise musical local: BPM + grelha de tempos, tom (K-S) e acordes (cromagrama + tríades).
// São estimativas por processamento de sinal, não modelos de IA: ver limitações na ajuda.

import { fft, NFFT } from './hspec.js';

export const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const tick = () => new Promise(r => setTimeout(r, 0));

export function monoOf(data) { const n = data[0].length, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (data[0][i] + data[1][i]) * 0.5; return m; }

// ---------- tempo ----------
const HOP = 256, WIN = 1024;
export function onsetEnvelope(mono) {
  const nf = Math.max(0, Math.floor((mono.length - WIN) / HOP));
  const rms = new Float32Array(nf);
  for (let f = 0; f < nf; f++) {
    let s = 0; const o = f * HOP;
    for (let i = 1; i < WIN; i++) { const d = mono[o + i] - mono[o + i - 1]; s += d * d; } // 1.ª diferença: realça ataques
    rms[f] = Math.sqrt(s / WIN);
  }
  const env = new Float32Array(nf);
  for (let f = 1; f < nf; f++) env[f] = Math.max(0, rms[f] - rms[f - 1]);
  let mean = 0; for (let f = 0; f < nf; f++) mean += env[f]; mean /= Math.max(1, nf);
  for (let f = 0; f < nf; f++) env[f] = Math.max(0, env[f] - mean * 0.5);
  return env;
}

/** @returns {{bpm:number, offset:number, confidence:number}|null} offset = instante (s) do 1.º tempo */
export function detectTempo(mono, rate) {
  const env = onsetEnvelope(mono), n = env.length;
  if (n < 400) return null;
  const fps = rate / HOP;
  let best = { score: -1, bpm: 0, phase: 0 }, total = 0, cnt = 0;
  for (let bpm = 60; bpm <= 200; bpm += 0.1) {
    const p = fps * 60 / bpm; // período em frames (fraccionário)
    let top = 0, topPh = 0;
    const steps = Math.floor(p);
    for (let ph = 0; ph < steps; ph++) {
      let s = 0, k = 0;
      for (let t = ph; t < n - 1; t += p, k++) s += env[Math.round(t)];
      s /= Math.max(1, k);
      if (s > top) { top = s; topPh = ph; }
    }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
    const sc = top * prior; total += top; cnt++;
    if (sc > best.score) best = { score: sc, bpm, phase: topPh };
  }
  const meanScore = total / cnt;
  return { bpm: Math.round(best.bpm * 10) / 10, offset: best.phase / fps, confidence: best.score / Math.max(1e-9, meanScore) };
}

// ---------- cromagrama, acordes, tom ----------
const CHWIN = Float64Array.from({ length: NFFT }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / NFFT));
export async function chromagram(mono, rate, hop = 2048) {
  const frames = [], re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  const lo = Math.ceil(80 * NFFT / rate), hi = Math.floor(2000 * NFFT / rate);
  const pc = new Int8Array(hi + 1);
  for (let k = lo; k <= hi; k++) { const m = 69 + 12 * Math.log2((k * rate / NFFT) / 440); pc[k] = ((Math.round(m) % 12) + 12) % 12; }
  for (let s = 0, f = 0; s + NFFT <= mono.length; s += hop, f++) {
    for (let i = 0; i < NFFT; i++) { re[i] = mono[s + i] * CHWIN[i]; im[i] = 0; }
    fft(re, im);
    const c = new Float32Array(12);
    for (let k = lo; k <= hi; k++) c[pc[k]] += Math.sqrt(Math.sqrt(re[k] * re[k] + im[k] * im[k])); // compressão (^0.5) reduz domínio dos graves
    frames.push({ t: (s + NFFT / 2) / rate, c });
    if (f % 200 === 0) await tick();
  }
  return frames;
}

const MAJ = [0, 4, 7], MIN = [0, 3, 7];
const TEMPL = [];
for (let r = 0; r < 12; r++) for (const [mode, iv] of [['', MAJ], ['m', MIN]]) {
  const v = new Float32Array(12); iv.forEach((x, i) => v[(r + x) % 12] = i === 1 ? 0.9 : 1);
  TEMPL.push({ root: r, mode, name: NOTE[r] + mode, v });
}
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < 12; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb + 1e-12); };

/** @returns {{t0:number,t1:number,name:string|null,root:number,mode:string}[]} */
export function detectChords(frames, duration, segLen) {
  const segs = [];
  const nSeg = Math.max(1, Math.ceil(duration / segLen));
  let maxE = 0; const sums = [];
  for (let s = 0; s < nSeg; s++) {
    const c = new Float32Array(12); let any = 0;
    for (const f of frames) if (f.t >= s * segLen && f.t < (s + 1) * segLen) { for (let i = 0; i < 12; i++) c[i] += f.c[i]; any++; }
    let e = 0; for (let i = 0; i < 12; i++) e += c[i]; e /= Math.max(1, any);
    sums.push({ c, e }); if (e > maxE) maxE = e;
  }
  let prev = null;
  for (let s = 0; s < nSeg; s++) {
    const { c, e } = sums[s];
    let cand = null;
    if (e > maxE * 0.08) {
      let best = -1, bi = 0;
      TEMPL.forEach((t, i) => { const sc = cos(c, t.v); if (sc > best) { best = sc; bi = i; } });
      cand = TEMPL[bi];
      if (prev && prev.name && prev.name !== cand.name && cos(c, prev.v) > best - 0.03) cand = prev; // histerese: evita oscilações
    }
    segs.push({ t0: s * segLen, t1: Math.min(duration, (s + 1) * segLen), name: cand ? cand.name : null, root: cand ? cand.root : -1, mode: cand ? cand.mode : '' });
    prev = cand;
  }
  const merged = [];
  for (const s of segs) { const l = merged[merged.length - 1]; if (l && l.name === s.name) l.t1 = s.t1; else merged.push({ ...s }); }
  return merged;
}

const KMAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KMIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export function detectKey(frames) {
  const c = new Float32Array(12);
  for (const f of frames) for (let i = 0; i < 12; i++) c[i] += f.c[i];
  const corr = (a, b) => { const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12; let d = 0, na = 0, nb = 0; for (let i = 0; i < 12; i++) { d += (a[i] - ma) * (b[i] - mb); na += (a[i] - ma) ** 2; nb += (b[i] - mb) ** 2; } return d / Math.sqrt(na * nb + 1e-12); };
  let best = { s: -2, root: 0, mode: 'maj' };
  for (let r = 0; r < 12; r++) for (const [mode, prof] of [['maj', KMAJ], ['min', KMIN]]) {
    const rot = Array.from({ length: 12 }, (_, i) => prof[(i - r + 12) % 12]);
    const s = corr(Array.from(c), rot); if (s > best.s) best = { s, root: r, mode };
  }
  return best;
}

export const transposeName = (root, mode, semis) => root < 0 ? 'N.C.' : NOTE[(((root + semis) % 12) + 12) % 12] + mode;
