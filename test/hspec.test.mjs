// Testes da STFT/iSTFT estilo Demucs: FFT vs DFT ingénua e reconstrução (ida e volta) sem deslocamento.
import assert from 'node:assert/strict';
import { demucsSpec, demucsIspec, fft, NFFT, NB } from '../js/core/hspec.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok  ', name); };

ok('FFT == DFT ingénua (bins 0..20 e 2047)', () => {
  const x = Float64Array.from({ length: NFFT }, (_, i) => Math.sin(i * 0.37) + 0.5 * Math.cos(i * 0.011) + (i % 7) / 10);
  const re = Float64Array.from(x), im = new Float64Array(NFFT); fft(re, im);
  for (const k of [0, 1, 2, 3, 5, 8, 13, 20, 2047]) {
    let sr = 0, si = 0;
    for (let t = 0; t < NFFT; t++) { const a = -2 * Math.PI * k * t / NFFT; sr += x[t] * Math.cos(a); si += x[t] * Math.sin(a); }
    assert.ok(Math.abs(sr - re[k]) < 1e-6 && Math.abs(si - im[k]) < 1e-6, `bin ${k}`);
  }
});

// sinal limitado em banda (o modelo descarta o bin de Nyquist)
const mk = (len, ph) => Float32Array.from({ length: len }, (_, i) => 0.4 * Math.sin(i * 0.05 + ph) + 0.2 * Math.sin(i * 0.31 + 2 * ph) + 0.1 * Math.sin(i * 1.1));

for (const len of [441000, 100000, 12345, 9000]) {
  ok(`ida e volta spec->ispec preserva o sinal e a posição (len=${len})`, () => {
    const L = mk(len, 0), R = mk(len, 1);
    const { mag, T } = demucsSpec(L, R);
    assert.equal(T, Math.ceil(len / 1024));
    assert.equal(mag.length, 4 * NB * T);
    const [a, b] = demucsIspec(mag, T, len);
    // Como no Demucs, os 2 frames de cada ponta que só cobrem preenchimento são descartados; as primeiras
    // ~1536 amostras de cada ponta dependem do ramo temporal do modelo, por isso testa-se o interior.
    const m = Math.min(2048, len >> 2);
    let e = 0; for (let i = m; i < len - m; i++) { e = Math.max(e, Math.abs(a[i] - L[i]), Math.abs(b[i] - R[i])); }
    assert.ok(e < 1e-4, `erro máx interior ${e}`);
  });
}

ok('ordem dos canais [L_re, L_im, R_re, R_im]: sinal só no canal esquerdo deixa R a zero', () => {
  const len = 20000, L = mk(len, 0), R = new Float32Array(len);
  const { mag, T } = demucsSpec(L, R);
  let l = 0, r = 0;
  for (let f = 0; f < NB; f++) for (let t = 0; t < T; t++) { l = Math.max(l, Math.abs(mag[(0 * NB + f) * T + t])); r = Math.max(r, Math.abs(mag[(2 * NB + f) * T + t]), Math.abs(mag[(3 * NB + f) * T + t])); }
  assert.ok(l > 1 && r === 0);
});
console.log(`\n${n} testes passaram`);
