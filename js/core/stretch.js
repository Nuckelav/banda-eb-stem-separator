// Alteração independente de velocidade e tom (WSOLA + reamostragem Catmull-Rom).
// Tudo local, sem dependências. speed: 0.5..1.5 (1 = original). semis: semitons (-12..12).
// Estéreo coerente: os deslocamentos são escolhidos no canal médio e aplicados aos dois canais.

const N = 2048, HS = N / 2, DELTA = 384, DEC = 4;
const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const tick = () => new Promise(r => setTimeout(r, 0));

/** Estica no tempo sem mudar o tom. tempo>1 = mais rápido (mais curto). */
export async function wsolaStretch(x, tempo, onProgress) {
  const len = x[0].length;
  if (Math.abs(tempo - 1) < 1e-6 || len < N * 2) return [Float32Array.from(x[0]), Float32Array.from(x[1])];
  const mid = new Float32Array(len);
  for (let i = 0; i < len; i++) mid[i] = (x[0][i] + x[1][i]) * 0.5;
  const outLen = Math.round(len / tempo);
  const L = new Float32Array(outLen + 2 * N), R = new Float32Array(outLen + 2 * N), W = new Float32Array(outLen + 2 * N);
  const HA = HS * tempo;
  let prev = 0;
  for (let k = 0; ; k++) {
    const nominal = Math.round(k * HA);
    if (nominal >= len - N || k * HS >= outLen) break;
    let pos = nominal;
    if (k > 0) {
      const target = prev + HS;
      let best = -Infinity, bestPos = nominal;
      const lo = Math.max(0, nominal - DELTA), hi = Math.min(len - N, nominal + DELTA);
      if (target + HS < len) {
        for (let c = lo; c <= hi; c += 2) {
          let dot = 0, en = 1e-9;
          for (let i = 0; i < HS; i += DEC) { const a = mid[c + i]; dot += a * mid[target + i]; en += a * a; }
          const sc = dot / Math.sqrt(en);
          if (sc > best) { best = sc; bestPos = c; }
        }
      }
      pos = bestPos;
    }
    const o = k * HS;
    for (let i = 0; i < N; i++) { const w = HANN[i]; L[o + i] += x[0][pos + i] * w; R[o + i] += x[1][pos + i] * w; W[o + i] += w; }
    prev = pos;
    if (k % 256 === 0) { onProgress?.(Math.min(1, nominal / len)); await tick(); }
  }
  const oL = new Float32Array(outLen), oR = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const w = W[i] > 1e-3 ? W[i] : 1; oL[i] = L[i] / w; oR[i] = R[i] / w; }
  return [oL, oR];
}

/** Reamostra por `f` (f>1: mais agudo e mais curto) com interpolação cúbica. */
export function resample(ch, f) {
  const n = ch.length, outN = Math.floor(n / f);
  const out = new Float32Array(outN);
  for (let i = 0; i < outN; i++) {
    const p = i * f, i1 = Math.floor(p), t = p - i1;
    const p0 = ch[Math.max(0, i1 - 1)], p1 = ch[i1], p2 = ch[Math.min(n - 1, i1 + 1)], p3 = ch[Math.min(n - 1, i1 + 2)];
    out[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

/** Velocidade final = speed, tom = semis semitons. Devolve [L,R] com duração ≈ len/speed. */
export async function processStereo(x, speed, semis, onProgress) {
  const f = Math.pow(2, semis / 12);
  const stretched = await wsolaStretch(x, speed / f, onProgress);
  return Math.abs(f - 1) < 1e-9 ? stretched : [resample(stretched[0], f), resample(stretched[1], f)];
}
