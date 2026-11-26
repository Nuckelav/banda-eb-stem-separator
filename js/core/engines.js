// Motores ONNX executados localmente com onnxruntime-web (WebGPU quando disponível, senão WebAssembly).
// Contrato do modelo suportado: entrada "mix" [1,2,SEG] float32 (44,1 kHz, [-1,1]) -> "stems" [1,N,2,SEG].
// É o formato dos exports HTDemucs "single-file" (ver models.js). Se um modelo não cumprir
// o contrato, o motor falha com mensagem explícita; nunca devolve dados inventados.

import { separateChunked } from './overlap.js';
import { demucsSpec, demucsIspec, NB } from './hspec.js';

const ORT_VERSION = '1.22.0';
export const ORT_BASE = (globalThis.BANDA_ORT_BASE) || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

let ortPromise;
export function loadOrt() {
  ortPromise ||= import(/* @vite-ignore */ ORT_BASE + 'ort.webgpu.min.mjs').then(ort => {
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = (globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1);
    return ort;
  });
  return ortPromise;
}

export async function hasWebGPU() {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
}

/** Descarrega um modelo com progresso e guarda-o na Cache API (fica local, não volta a ser descarregado). */
export async function fetchModel(url, onProgress, sha256) {
  const cache = await caches.open('banda-eb-models').catch(() => null);
  const hit = cache && await cache.match(url);
  if (hit) { onProgress?.(1); return new Uint8Array(await hit.arrayBuffer()); }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Não foi possível descarregar o modelo (HTTP ${r.status}) em ${url}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const reader = r.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) onProgress?.(Math.min(1, got / total));
  }
  const u8 = new Uint8Array(got); let o = 0;
  for (const c of chunks) { u8.set(c, o); o += c.length; }
  if (sha256) {
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (h !== sha256.toLowerCase()) throw new Error(`Verificação de integridade falhou para ${url}: SHA-256 obtido ${h}`);
  }
  if (cache) { try { await cache.put(url, new Response(u8, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* sem espaço */ } }
  onProgress?.(1);
  return u8;
}

export class OnnxStemEngine {
  constructor(cfg) { this.cfg = cfg; this.session = null; this.ort = null; this.provider = null; }

  async load(onProgress) {
    const cfg = this.cfg;
    if (!cfg.url) throw new Error(`Modelo "${cfg.label}" sem URL configurado.`);
    this.ort = await loadOrt();
    const bytes = await fetchModel(cfg.url, onProgress, cfg.sha256);
    const order = (await hasWebGPU()) ? ['webgpu', 'wasm'] : ['wasm'];
    let lastErr;
    for (const ep of order) {
      try {
        this.session = await this.ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
        this.provider = ep; break;
      } catch (e) { lastErr = e; }
    }
    if (!this.session) throw new Error(`Falha ao iniciar o modelo: ${lastErr?.message || lastErr}`);
    this.checkIO();
  }

  checkIO() {
    const io = this.cfg.io;
    if (!this.session.inputNames.includes(io.input) || !this.session.outputNames.includes(io.output)) {
      throw new Error(`Modelo incompatível: entradas [${this.session.inputNames}] saídas [${this.session.outputNames}]; esperado "${io.input}" -> "${io.output}".`);
    }
  }

  /** Executa um segmento: [2*seg] -> [nStems*2*seg]. Subclasses podem substituir. */
  async runChunk(input) {
    const { segment, io } = this.cfg, ort = this.ort;
    const feeds = { [io.input]: new ort.Tensor('float32', input, [1, 2, segment]) };
    const res = await this.session.run(feeds);
    const t = res[io.output];
    const data = Float32Array.from(t.data);
    t.dispose?.(); feeds[io.input].dispose?.();
    return data;
  }

  async separate(stereo, onProgress, signal) {
    const { segment, overlap, normalize } = this.cfg;
    const n = this.cfg.stems.length;
    let work = stereo, mean = 0, std = 1;
    if (normalize) { // opcional, só se o export do modelo NÃO normalizar internamente
      let s = 0, s2 = 0; const N = stereo[0].length;
      for (let i = 0; i < N; i++) { const m = (stereo[0][i] + stereo[1][i]) / 2; s += m; s2 += m * m; }
      mean = s / N; std = Math.sqrt(Math.max(s2 / N - mean * mean, 1e-12)) || 1;
      work = stereo.map(ch => ch.map(x => (x - mean) / std));
    }
    const out = await separateChunked(work, {
      segment, overlap, nStems: n, onProgress, signal,
      runChunk: async (input) => {
        const data = await this.runChunk(input);
        await new Promise(r => setTimeout(r)); // devolve o controlo à interface
        return data;
      },
    });
    if (normalize) for (const st of out) for (const ch of st) for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * std + mean;
    return out;
  }

  dispose() { try { this.session?.release?.(); } catch { /* ok */ } this.session = null; }
}

/**
 * Modelos Hybrid Demucs com STFT fora do grafo (ex.: DrumSep v2 ONNX).
 * Entradas: mix [1,2,SEG] e mag [1,4,2048,T] (complex-as-channels); saídas: freq_out [1,S,4,2048,T] e time_out [1,S,2,SEG].
 * Saída final por stem = iSTFT(freq_out) + time_out, como no Demucs. As formas são validadas em execução.
 */
export class HybridCacEngine extends OnnxStemEngine {
  checkIO() {
    const io = this.cfg.io, have = n => this.session.inputNames.includes(n), out = n => this.session.outputNames.includes(n);
    if (!have(io.input) || !have(io.spec) || !out(io.freq) || !out(io.time)) {
      throw new Error(`Modelo incompatível: entradas [${this.session.inputNames}] saídas [${this.session.outputNames}]; esperado "${io.input}","${io.spec}" -> "${io.freq}","${io.time}".`);
    }
  }

  async runChunk(input) {
    const { segment: seg, io } = this.cfg, S = this.cfg.stems.length, ort = this.ort;
    const { mag, T } = demucsSpec(input.subarray(0, seg), input.subarray(seg));
    const feeds = {
      [io.input]: new ort.Tensor('float32', input, [1, 2, seg]),
      [io.spec]: new ort.Tensor('float32', mag, [1, 4, NB, T]),
    };
    const res = await this.session.run(feeds);
    const freq = res[io.freq].data, time = res[io.time].data;
    if (freq.length !== S * 4 * NB * T || time.length !== S * 2 * seg) {
      throw new Error(`Saída inesperada do modelo: freq ${freq.length} (esperado ${S * 4 * NB * T}), tempo ${time.length} (esperado ${S * 2 * seg}).`);
    }
    const out = new Float32Array(S * 2 * seg);
    for (let s = 0; s < S; s++) {
      const [l, r] = demucsIspec(freq.subarray(s * 4 * NB * T, (s + 1) * 4 * NB * T), T, seg);
      const o = s * 2 * seg, tt = s * 2 * seg;
      for (let i = 0; i < seg; i++) { out[o + i] = l[i] + time[tt + i]; out[o + seg + i] = r[i] + time[tt + seg + i]; }
    }
    return out;
  }
}

export const createEngine = cfg => (cfg.type === 'hybrid-cac' ? new HybridCacEngine(cfg) : new OnnxStemEngine(cfg));
