import { DEFAULT_ENGINES } from './models.js';
import { fetchModel } from './core/engines.js';

const out = document.getElementById('out');
const log = (...a) => { out.textContent += a.join(' ') + '\n'; };
const q = new URLSearchParams(location.search);

async function variant(ort, bytes, name, opts, feedsFn) {
  const t0 = performance.now();
  try {
    const s = await ort.InferenceSession.create(bytes, opts);
    log(`  [OK] ${name}: sessão criada em ${((performance.now() - t0) / 1000).toFixed(1)} s; entradas [${s.inputNames}] saídas [${s.outputNames}]`);
    if (feedsFn) {
      const t1 = performance.now();
      try {
        const res = await s.run(feedsFn(ort));
        log(`  [OK] ${name}: inferência em ${((performance.now() - t1) / 1000).toFixed(1)} s; ` + Object.entries(res).map(([k, v]) => `${k} ${JSON.stringify(v.dims)}`).join(', '));
      } catch (e) { log(`  [ERRO] ${name}: inferência falhou: ${e?.message || e}`); }
    }
    try { await s.release(); } catch { /* ok */ }
    return true;
  } catch (e) { log(`  [ERRO] ${name}: ${e?.message || e}`); return false; }
}

document.getElementById('run').addEventListener('click', async () => {
  out.textContent = ''; document.getElementById('run').disabled = true;
  try {
    const cfg = DEFAULT_ENGINES.find(e => e.id === document.getElementById('which').value);
    const ver = q.get('ort') || '1.22.0', bundle = q.get('bundle') || 'ort.webgpu.min.mjs';
    const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ver}/dist/`;
    log(`Navegador: ${navigator.userAgent}`);
    log(`crossOriginIsolated=${globalThis.crossOriginIsolated} núcleos=${navigator.hardwareConcurrency} memória(GB)=${navigator.deviceMemory ?? 'n/d'} WebGPU=${!!navigator.gpu}`);
    if (navigator.gpu) { try { const a = await navigator.gpu.requestAdapter(); const i = a ? (a.info || {}) : {}; log(`Adaptador WebGPU: ${a ? `${i.vendor || ''} ${i.architecture || ''} ${i.description || ''}` : 'nenhum'}; maxBuffer=${a?.limits?.maxBufferSize}`); } catch (e) { log('Adaptador WebGPU erro: ' + e); } }
    log(`ORT ${ver} (${bundle})`);
    const ort = await import(base + bundle);
    ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1;
    log(`Modelo: ${cfg.label}\n  ${cfg.url}`);
    let last = 0;
    const bytes = await fetchModel(cfg.url, p => { if (p - last > 0.1) { last = p; log(`  descarregado ${(p * 100).toFixed(0)}%`); } }, cfg.sha256);
    log(`  ${(bytes.length / 1048576).toFixed(0)} MB descarregados${cfg.sha256 ? ', SHA-256 verificado' : ''}`);
    const seg = cfg.segment;
    const feeds = o => {
      const mix = new Float32Array(2 * seg).map((_, i) => 0.1 * Math.sin(i * 0.05));
      const f = { [cfg.io.input]: new o.Tensor('float32', mix, [1, 2, seg]) };
      if (cfg.io.spec) f[cfg.io.spec] = new o.Tensor('float32', new Float32Array(4 * 2048 * Math.ceil(seg / 1024)), [1, 4, 2048, Math.ceil(seg / 1024)]);
      return f;
    };
    log('\nVariantes de arranque (a primeira com sucesso é a recomendada):');
    const V = [
      ['wasm, otimização basic', { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' }],
      ['wasm, otimização all', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }],
      ['wasm, sem otimização', { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' }],
      ['webgpu, otimização basic', { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'basic' }],
      ['webgpu, otimização all', { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all' }],
    ];
    for (const [name, opts] of V) { await variant(ort, bytes, name, opts, q.get('run') === '1' ? feeds : null); }
    log('\nFim do diagnóstico.');
  } catch (e) { log('ERRO GERAL: ' + (e?.stack || e)); }
  document.getElementById('run').disabled = false;
});
if (q.get('auto') === '1') document.getElementById('run').click();
