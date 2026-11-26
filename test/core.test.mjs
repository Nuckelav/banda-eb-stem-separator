// Testes da lógica de áudio que não depende de modelos: duração, sincronização, overlap-add,
// reconstrução, pipeline com resíduo, WAV e ZIP. Corre com: node test/core.test.mjs
import assert from 'node:assert/strict';
import { separateChunked, planChunks } from '../js/core/overlap.js';
import { encodeWav, decodeWavHeader } from '../js/core/wav.js';
import { makeZip, crc32 } from '../js/core/zip.js';
import { mixDown, snrDb, leaves } from '../js/core/tracks.js';
import { runPipeline } from '../js/core/pipeline.js';
import { memoryStore } from '../js/core/store.js';

let n = 0; const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('ok  ', name); });

const SEG = 1000, OV = 250;
const ratios = [0.4, 0.3, 0.2, 0.1];
// "Modelo" linear de teste: stem_k = ratio_k * entrada. Permite medir exactamente sincronização e soma.
const fakeRun = async (input) => {
  const out = new Float32Array(4 * 2 * SEG);
  ratios.forEach((r, s) => { for (let i = 0; i < 2 * SEG; i++) out[s * 2 * SEG + i] = input[i] * r; });
  return out;
};
const sig = (len) => [Float32Array.from({ length: len }, (_, i) => Math.sin(i * 0.05) * 0.8), Float32Array.from({ length: len }, (_, i) => Math.cos(i * 0.031) * 0.6)];

await ok('planChunks cobre todo o comprimento', () => {
  for (const total of [1, 999, 1000, 1001, 1750, 1751, 5000, 12345]) {
    const st = planChunks(total, SEG, OV);
    assert.ok(st[st.length - 1] + SEG >= total, `total ${total}`);
  }
  assert.deepEqual(planChunks(0, SEG, OV), []);
});

for (const len of [1, 500, 1000, 1001, 1750, 4321, 10000]) {
  await ok(`duração preservada e soma das pistas == original (len=${len})`, async () => {
    const x = sig(len);
    const stems = await separateChunked(x, { segment: SEG, overlap: OV, nStems: 4, runChunk: fakeRun });
    assert.equal(stems.length, 4);
    for (const s of stems) { assert.equal(s[0].length, len); assert.equal(s[1].length, len); }
    let maxErr = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < len; i++) {
      const sum = stems.reduce((a, s) => a + s[c][i], 0);
      maxErr = Math.max(maxErr, Math.abs(sum - x[c][i]));
      for (let k = 0; k < 4; k++) maxErr = Math.max(maxErr, Math.abs(stems[k][c][i] - ratios[k] * x[c][i]));
    }
    assert.ok(maxErr < 1e-6, `erro máx ${maxErr}`);
  });
}

await ok('sem atraso: impulso mantém a posição em cada pista (incl. pontas e junções)', async () => {
  for (const pos of [0, 1, 749, 750, 751, 1499, 3999, 4320]) {
    const len = 4321;
    const x = [new Float32Array(len), new Float32Array(len)]; x[0][pos] = 1; x[1][pos] = 1;
    const stems = await separateChunked(x, { segment: SEG, overlap: OV, nStems: 4, runChunk: fakeRun });
    stems.forEach((s, k) => {
      let arg = 0; for (let i = 0; i < len; i++) if (Math.abs(s[0][i]) > Math.abs(s[0][arg])) arg = i;
      assert.equal(arg, pos, `stem ${k} pos ${pos}`);
      assert.ok(Math.abs(s[0][pos] - ratios[k]) < 1e-6);
    });
  }
});

await ok('saída de tamanho errado do modelo é rejeitada (não inventa dados)', async () => {
  await assert.rejects(() => separateChunked(sig(2000), { segment: SEG, overlap: OV, nStems: 4, runChunk: async () => new Float32Array(10) }), /tamanho inesperado/);
});

await ok('cancelamento', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(() => separateChunked(sig(3000), { segment: SEG, overlap: OV, nStems: 4, runChunk: fakeRun, signal: ac.signal }), e => e.name === 'AbortError');
});

// Pipeline com motor base + especialista de bateria falso (estruturalmente igual ao real)
const baseCfg = { id: 'base', role: 'base', label: 'base', url: 'x', stems: [
  { key: 'drums', name: 'Bateria', category: 'Bateria' }, { key: 'bass', name: 'Baixo', category: 'Cordas' },
  { key: 'other', name: 'Outros', category: 'Outros' }, { key: 'vocals', name: 'Voz', category: 'Vocais' }] };
const drumCfg = { id: 'drum', role: 'split', inputFrom: 'drums', label: 'drum', url: 'y', stems: [
  { key: 'kick', name: 'Kick', category: 'Bateria' }, { key: 'snare', name: 'Snare', category: 'Bateria' },
  { key: 'cym', name: 'Cym', category: 'Bateria' }, { key: 'toms', name: 'Toms', category: 'Bateria' }] };
const mkEngine = (cfg) => ({
  load: async () => {}, dispose() {},
  separate: async (stereo) => separateChunked(stereo, {
    segment: SEG, overlap: OV, nStems: cfg.stems.length,
    runChunk: async (inp) => { const k = cfg.stems.length, o = new Float32Array(k * 2 * SEG); for (let s = 0; s < k; s++) for (let i = 0; i < 2 * SEG; i++) o[s * 2 * SEG + i] = inp[i] * (0.3 - 0.05 * s); return o; } }),
});

await ok('pipeline: pista-mãe substituída pelas filhas + resíduo, soma == original, cache reutilizada', async () => {
  const x = sig(5555); const store = memoryStore();
  const run = () => runPipeline({ stereo: x, fileKey: 'abc', configs: [baseCfg, drumCfg], createEngine: mkEngine, store });
  const r1 = await run();
  const lv = leaves(r1.tracks);
  assert.ok(!lv.some(t => t.key === 'drums'), 'a mãe não pode contar na soma');
  assert.ok(['kick', 'snare', 'cym', 'toms', 'drums-residuo'].every(k => lv.some(t => t.key === k)));
  const rec = mixDown(r1.tracks, 5555);
  // base fake soma 0.3+0.25+0.2+0.15=0.9 do original; o ponto aqui é que a soma das folhas == soma dos pais
  const parentsOnly = [r1.tracks.find(t => t.key === 'drums'), ...r1.tracks.filter(t => ['bass', 'other', 'vocals'].includes(t.key))];
  const ref = [new Float32Array(5555), new Float32Array(5555)];
  for (const t of parentsOnly) for (let c = 0; c < 2; c++) for (let i = 0; i < 5555; i++) ref[c][i] += t.data[c][i];
  let e = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < 5555; i++) e = Math.max(e, Math.abs(rec[c][i] - ref[c][i]));
  assert.ok(e < 1e-5, `soma das folhas difere da soma dos pais: ${e}`);
  assert.ok(snrDb(ref, rec) > 80);
  const r2 = await run();
  assert.ok(r2.report.some(r => r.status === 'cache'));
});

await ok('pipeline: falha do especialista é reportada e a mãe mantém-se como folha', async () => {
  const bad = (cfg) => cfg.id === 'drum' ? { load: async () => { throw new Error('modelo 404'); }, dispose() {}, separate: async () => [] } : mkEngine(cfg);
  const r = await runPipeline({ stereo: sig(2000), fileKey: 'k', configs: [baseCfg, drumCfg], createEngine: bad, store: memoryStore() });
  assert.ok(r.report.find(x => x.engine === 'drum').status === 'falhou');
  assert.ok(leaves(r.tracks).some(t => t.key === 'drums'));
  assert.ok(!r.tracks.some(t => t.key === 'kick'), 'nenhuma peça de bateria pode aparecer sem ter sido separada');
});

await ok('WAV: cabeçalho e comprimento (16/24/32f)', () => {
  const x = sig(1234);
  for (const bd of [16, 24, 32]) {
    const w = encodeWav(x, 44100, bd); const h = decodeWavHeader(w);
    assert.equal(h.channels, 2); assert.equal(h.sampleRate, 44100); assert.equal(h.bitDepth, bd);
    assert.equal(h.dataSize, 1234 * 2 * bd / 8); assert.equal(w.length, 44 + h.dataSize);
    assert.equal(h.format, bd === 32 ? 3 : 1);
  }
});

await ok('WAV 32f é bit-exacto; 24 bits tem erro < 1.3e-7', () => {
  const x = sig(500); const w = encodeWav(x, 44100, 32); const dv = new DataView(w.buffer);
  for (let i = 0; i < 500; i++) assert.equal(dv.getFloat32(44 + i * 8, true), x[0][i]);
  const w24 = encodeWav(x, 44100, 24);
  for (let i = 0; i < 500; i++) {
    let q = w24[44 + i * 6] | (w24[45 + i * 6] << 8) | (w24[46 + i * 6] << 16); if (q & 0x800000) q -= 0x1000000;
    assert.ok(Math.abs(q / 0x7fffff - x[0][i]) < 1.3e-7);
  }
});

await ok('ZIP: CRC e estrutura', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const files = [{ name: 'a.wav', data: new Uint8Array([1, 2, 3]) }, { name: 'b.wav', data: new Uint8Array(1000).fill(7) }];
  const blob = makeZip(files); const u8 = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(u8.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(u8.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(u8.length - 22 + 10, true), 2);
});

console.log(`\n${n} testes passaram`);
