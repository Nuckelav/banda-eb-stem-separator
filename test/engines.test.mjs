// Testa o HybridCacEngine com um "modelo" de teste: freq_out[s] = ratio[s] * mag, time_out = 0.
// Valida o encaixe completo (STFT -> modelo -> iSTFT -> overlap-add) no interior do sinal.
import assert from 'node:assert/strict';
import { HybridCacEngine } from '../js/core/engines.js';
import { NB } from '../js/core/hspec.js';

class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const ratios = [0.4, 0.3, 0.2, 0.1];
const cfg = { id: 'd', label: 'd', type: 'hybrid-cac', segment: 100000, overlap: 25000, normalize: false,
  io: { input: 'mix', spec: 'mag', freq: 'freq_out', time: 'time_out' }, stems: ratios.map((_, i) => ({ key: 'k' + i })) };
const eng = new HybridCacEngine(cfg);
eng.ort = { Tensor };
eng.session = {
  inputNames: ['mix', 'mag'], outputNames: ['freq_out', 'time_out'],
  async run(feeds) {
    const mag = feeds.mag.data, [, , , T] = feeds.mag.dims, seg = feeds.mix.dims[2];
    assert.deepEqual(feeds.mag.dims, [1, 4, NB, T]); assert.equal(T, Math.ceil(seg / 1024));
    const f = new Float32Array(4 * 4 * NB * T);
    ratios.forEach((r, s) => { for (let i = 0; i < 4 * NB * T; i++) f[s * 4 * NB * T + i] = mag[i] * r; });
    return { freq_out: { data: f }, time_out: { data: new Float32Array(4 * 2 * seg) } };
  },
};
eng.checkIO();

const len = 260000;
const x = [0, 1].map(ph => Float32Array.from({ length: len }, (_, i) => 0.4 * Math.sin(i * 0.05 + ph) + 0.2 * Math.sin(i * 0.31)));
const out = await eng.separate(x);
assert.equal(out.length, 4);
let e = 0;
for (let s = 0; s < 4; s++) { assert.equal(out[s][0].length, len); for (let i = 3000; i < len - 3000; i++) e = Math.max(e, Math.abs(out[s][0][i] - ratios[s] * x[0][i])); }
assert.ok(e < 1e-3, `erro ${e}`);
console.log('ok   HybridCacEngine: duração preservada, 4 stems proporcionais, erro interior', e.toExponential(2));

// formas erradas devem falhar de forma explícita
eng.session.run = async () => ({ freq_out: { data: new Float32Array(10) }, time_out: { data: new Float32Array(10) } });
await assert.rejects(() => eng.separate(x), /Saída inesperada/);
console.log('ok   forma de saída errada é rejeitada');
