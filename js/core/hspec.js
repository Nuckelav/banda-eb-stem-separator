// STFT/iSTFT no estilo Hybrid Demucs ("complex-as-channels"), para modelos ONNX em que a
// transformada fica FORA do grafo (ex.: DrumSep v2 em ONNX). Reproduz demucs/hdemucs.py:
// n_fft 4096, hop 1024, janela de Hann periódica, normalized=True, reflect, descarta o último
// bin e 2 frames de cada lado. Canais da magnitude: [L_re, L_im, R_re, R_im].

export const NFFT = 4096, HOP = 1024, NB = 2048;

// ---------- FFT radix-2 ----------
const rev = new Uint16Array(NFFT);
const cosT = new Float64Array(NFFT / 2), sinT = new Float64Array(NFFT / 2);
(() => {
  const bits = Math.log2(NFFT);
  for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < NFFT / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / NFFT); sinT[i] = -Math.sin(2 * Math.PI * i / NFFT); }
})();
const WIN = Float64Array.from({ length: NFFT }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / NFFT));

/** FFT in-place (inverse=false: e^{-i}; inverse=true: e^{+i}, sem normalização). */
export function fft(re, im, inverse = false) {
  for (let i = 0; i < NFFT; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1, step = NFFT / size;
    for (let s = 0; s < NFFT; s += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cosT[w], wi = inverse ? -sinT[w] : sinT[w];
        const a = s + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

const reflect = (i, n) => { if (i < 0) i = -i; if (i >= n) i = 2 * (n - 1) - i; return i; };

/** @returns {{mag: Float32Array, T: number}} mag com forma [4, NB, T] (c, f, t), T = ceil(len/HOP) */
export function demucsSpec(L, R) {
  const len = L.length, le = Math.ceil(len / HOP), pad = HOP / 2 * 3;
  const P = len + 2 * pad + (le * HOP - len);
  const T = le;
  const mag = new Float32Array(4 * NB * T);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  const norm = 1 / Math.sqrt(NFFT);
  const padded = ch => { // reflect no sinal original, depois reflect centrado por frame
    const p = new Float32Array(P);
    for (let i = 0; i < P; i++) p[i] = ch[reflect(i - pad, len)];
    return p;
  };
  const chans = [padded(L), padded(R)];
  for (let c = 0; c < 2; c++) {
    const p = chans[c];
    for (let t = 0; t < T; t++) {
      const frame = t + 2; // descarta os 2 primeiros frames
      const start = frame * HOP - NFFT / 2;
      for (let n = 0; n < NFFT; n++) { re[n] = p[reflect(start + n, P)] * WIN[n]; im[n] = 0; }
      fft(re, im);
      for (let f = 0; f < NB; f++) {
        mag[((c * 2) * NB + f) * T + t] = re[f] * norm;
        mag[((c * 2 + 1) * NB + f) * T + t] = im[f] * norm;
      }
    }
  }
  return { mag, T };
}

/** z: [4, NB, T] (um stem) -> [Float32Array L, Float32Array R] com `length` amostras. */
export function demucsIspec(z, T, length) {
  const pad = HOP / 2 * 3;
  const frames = T + 4;                      // 2 frames de zeros de cada lado
  const total = HOP * (frames - 1) + NFFT;   // antes de retirar o centro
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  const out = [new Float32Array(length), new Float32Array(length)];
  const scale = Math.sqrt(NFFT) / NFFT;      // desfaz normalized=True e normaliza a IFFT
  const env = new Float64Array(total);
  for (let f = 0; f < frames; f++) for (let n = 0; n < NFFT; n++) env[f * HOP + n] += WIN[n] * WIN[n];
  for (let c = 0; c < 2; c++) {
    const ola = new Float64Array(total);
    for (let f = 0; f < frames; f++) {
      const t = f - 2;
      re.fill(0); im.fill(0);
      if (t >= 0 && t < T) {
        for (let k = 0; k < NB; k++) {
          const a = z[((c * 2) * NB + k) * T + t], b = z[((c * 2 + 1) * NB + k) * T + t];
          re[k] = a; im[k] = b;
          if (k > 0) { re[NFFT - k] = a; im[NFFT - k] = -b; }   // simetria hermitiana
        }                                                      // bin de Nyquist = 0 (descartado pelo modelo)
        fft(re, im, true);
        for (let n = 0; n < NFFT; n++) ola[f * HOP + n] += re[n] * scale * WIN[n];
      }
    }
    // retira o preenchimento "center" (NFFT/2) e depois o `pad` do Demucs
    const off = NFFT / 2 + pad;
    for (let i = 0; i < length; i++) { const e = env[off + i]; out[c][i] = e > 1e-11 ? ola[off + i] / e : 0; }
  }
  return out;
}
