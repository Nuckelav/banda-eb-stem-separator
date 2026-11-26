// Separação por segmentos com overlap-add normalizado.
// Independente do ambiente (browser / Node) para poder ser testado.
// Garante: mesma duração à saída, sem deslocamento temporal, sem cortes nas pontas.

export function planChunks(total, seg, overlap) {
  if (total <= 0) return [];
  const hop = seg - overlap;
  if (hop <= 0) throw new Error('overlap tem de ser menor que o segmento');
  const starts = [];
  for (let s = 0; ; s += hop) {
    starts.push(s);
    if (s + seg >= total) break;
  }
  return starts;
}

export function makeWindow(seg, overlap, validLen, isFirst, isLast) {
  const w = new Float32Array(seg);
  for (let t = 0; t < validLen; t++) {
    const left = isFirst ? 1 : Math.min(1, (t + 1) / overlap);
    const right = isLast ? 1 : Math.min(1, (seg - t) / overlap);
    w[t] = left * right;
  }
  return w;
}

/**
 * @param {[Float32Array, Float32Array]} stereo  canais L,R (mesmo comprimento)
 * @param {object} o
 * @param {number} o.segment    amostras por segmento do modelo
 * @param {number} o.overlap    amostras de sobreposição
 * @param {number} o.nStems     nº de pistas devolvidas pelo modelo
 * @param {(input:Float32Array)=>Promise<Float32Array>} o.runChunk
 *        recebe [2*seg] (L depois R) e devolve [nStems*2*seg] (stem-major, depois canal)
 * @returns {Promise<Array<[Float32Array, Float32Array]>>}
 */
export async function separateChunked(stereo, o) {
  const { segment: seg, overlap, nStems, runChunk, onProgress, signal } = o;
  const total = stereo[0].length;
  const out = Array.from({ length: nStems }, () => [new Float32Array(total), new Float32Array(total)]);
  const wsum = new Float32Array(total);
  const starts = planChunks(total, seg, overlap);

  for (let i = 0; i < starts.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const start = starts[i];
    const validLen = Math.min(seg, total - start);
    const input = new Float32Array(2 * seg); // zero-padded no fim
    input.set(stereo[0].subarray(start, start + validLen), 0);
    input.set(stereo[1].subarray(start, start + validLen), seg);

    const res = await runChunk(input);
    if (res.length !== nStems * 2 * seg) {
      throw new Error(`Saída do modelo com tamanho inesperado: ${res.length} (esperado ${nStems * 2 * seg})`);
    }
    const w = makeWindow(seg, overlap, validLen, i === 0, i === starts.length - 1);
    for (let t = 0; t < validLen; t++) wsum[start + t] += w[t];
    for (let s = 0; s < nStems; s++) {
      for (let c = 0; c < 2; c++) {
        const base = (s * 2 + c) * seg;
        const dst = out[s][c];
        for (let t = 0; t < validLen; t++) dst[start + t] += res[base + t] * w[t];
      }
    }
    onProgress?.((i + 1) / starts.length);
  }
  for (let t = 0; t < total; t++) {
    const k = wsum[t] > 0 ? 1 / wsum[t] : 0;
    for (let s = 0; s < nStems; s++) { out[s][0][t] *= k; out[s][1][t] *= k; }
  }
  return out;
}
