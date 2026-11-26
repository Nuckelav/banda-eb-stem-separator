// Testes das funções de prática: velocidade/tom independentes, BPM, acordes e tom.
import assert from 'node:assert/strict';
import { wsolaStretch, resample, processStereo } from '../js/core/stretch.js';
import { detectTempo, monoOf, chromagram, detectChords, detectKey, transposeName } from '../js/core/analysis.js';

const R = 44100;
const sine = (f, secs, amp = 0.5) => Float32Array.from({ length: Math.round(R * secs) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / R));
const freqOf = (x, from, to) => { // frequência por cruzamentos ascendentes de zero
  let c = 0, first = -1, last = -1;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) if (x[i - 1] <= 0 && x[i] > 0) { c++; if (first < 0) first = i; last = i; }
  return (c - 1) * R / (last - first);
};
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

await ok('velocidade 1.5x: duração /1.5, tom preservado (440 Hz)', async () => {
  const x = sine(440, 4); const [L] = await wsolaStretch([x, x], 1.5);
  assert.ok(Math.abs(L.length - x.length / 1.5) < 10, `len ${L.length}`);
  const f = freqOf(L, 8000, L.length - 8000); assert.ok(Math.abs(f - 440) < 4, `f ${f}`);
});
await ok('velocidade 0.6x: duração /0.6, tom preservado', async () => {
  const x = sine(330, 4); const [L] = await wsolaStretch([x, x], 0.6);
  assert.ok(Math.abs(L.length - x.length / 0.6) < 10);
  const f = freqOf(L, 8000, L.length - 8000); assert.ok(Math.abs(f - 330) < 4, `f ${f}`);
});
await ok('tom +12 semitons com velocidade 1: mesma duração, 880 Hz', async () => {
  const x = sine(440, 4); const [L] = await processStereo([x, x], 1, 12);
  assert.ok(Math.abs(L.length - x.length) < 4, `len ${L.length}`);
  const f = freqOf(L, 8000, L.length - 8000); assert.ok(Math.abs(f - 880) < 6, `f ${f}`);
});
await ok('tom -2 semitons + velocidade 0.8: duração /0.8, 392 Hz', async () => {
  const x = sine(440, 4); const [L] = await processStereo([x, x], 0.8, -2);
  assert.ok(Math.abs(L.length - x.length / 0.8) < 12, `len ${L.length}`);
  const f = freqOf(L, 8000, L.length - 8000); assert.ok(Math.abs(f - 440 * Math.pow(2, -2 / 12)) < 5, `f ${f}`);
});
await ok('estéreo coerente: canais idênticos continuam idênticos', async () => {
  const x = sine(500, 2); const [L, Rr] = await wsolaStretch([x, Float32Array.from(x)], 1.25);
  for (let i = 0; i < L.length; i++) assert.equal(L[i], Rr[i]);
});

const clicks = (bpm, off, secs) => { const x = new Float32Array(Math.round(R * secs)), p = 60 / bpm; for (let t = off; t < secs; t += p) { const s = Math.round(t * R); for (let i = 0; i < 400 && s + i < x.length; i++) x[s + i] = 0.8 * Math.exp(-i / 60) * Math.sin(i * 0.6); } return x; };
for (const [bpm, off] of [[100, 0.3], [128, 0.1], [75, 0.45]]) {
  await ok(`BPM ${bpm} detetado (±1) e fase (±40 ms)`, () => {
    const t = detectTempo(clicks(bpm, off, 30), R);
    assert.ok(Math.abs(t.bpm - bpm) <= 1, `bpm ${t.bpm}`);
    const p = 60 / bpm; let d = Math.abs(((t.offset - off) % p + p) % p); d = Math.min(d, p - d);
    assert.ok(d < 0.04, `fase ${d}`);
  });
}

const chord = (freqs, secs) => { const x = new Float32Array(Math.round(R * secs)); for (const f of freqs) for (let h = 1; h <= 3; h++) for (let i = 0; i < x.length; i++) x[i] += (0.2 / h) * Math.sin(2 * Math.PI * f * h * i / R); return x; };
const cat = (...a) => { const out = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const C = [261.63, 329.63, 392.0], F = [349.23, 440.0, 523.25], G = [392.0, 493.88, 587.33], Am = [220.0, 261.63, 329.63];
await ok('acordes C, F, G, Am e tom de Dó maior', async () => {
  const x = cat(chord(C, 3), chord(F, 3), chord(G, 3), chord(Am, 3), chord(C, 3));
  const fr = await chromagram(x, R); const ch = detectChords(fr, 15, 1);
  assert.deepEqual(ch.map(c => c.name), ['C', 'F', 'G', 'Am', 'C']);
  const k = detectKey(fr); assert.equal(k.root, 0); assert.equal(k.mode, 'maj');
});
await ok('silêncio dá "sem acorde"; transposição de nomes', async () => {
  const fr = await chromagram(cat(chord(C, 3), new Float32Array(R * 3)), R); const ch = detectChords(fr, 6, 1);
  assert.equal(ch[0].name, 'C'); assert.equal(ch[ch.length - 1].name, null);
  assert.equal(transposeName(0, '', 2), 'D'); assert.equal(transposeName(9, 'm', 3), 'Cm'); assert.equal(transposeName(-1, '', 3), 'N.C.');
});
console.log(`\n${n} testes passaram`);
