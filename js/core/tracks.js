// Modelo de pistas: cada pista tem dados reais produzidos por um motor.
// Uma pista "mãe" que tenha filhas deixa de contar na reconstrução (evita duplicação).

export const CATEGORIES = ['Bateria', 'Percussão', 'Cordas', 'Teclados', 'Metais e sopros', 'Vocais', 'Outros'];

let seq = 0;
export function newTrack({ key, name, category, data, parent = null, engine, note = '' }) {
  return { id: `t${++seq}`, key, name, category, data, parent, engine, note, volume: 1, muted: false, solo: false };
}

export function childrenOf(tracks, id) { return tracks.filter(t => t.parent === id); }
export function leaves(tracks) { return tracks.filter(t => !tracks.some(c => c.parent === t.id)); }

/** Soma de pistas folha, com um ganho opcional por pista. Devolve [L,R]. */
export function mixDown(tracks, length, gainOf = () => 1) {
  const L = new Float32Array(length), R = new Float32Array(length);
  for (const t of leaves(tracks)) {
    const g = gainOf(t);
    if (!g) continue;
    const a = t.data[0], b = t.data[1];
    for (let i = 0; i < length; i++) { L[i] += a[i] * g; R[i] += b[i] * g; }
  }
  return [L, R];
}

/** Relação sinal/erro (dB) entre a mistura original e a reconstruída. */
export function snrDb(orig, rec) {
  let s = 0, e = 0;
  for (let c = 0; c < 2; c++) {
    const o = orig[c], r = rec[c];
    for (let i = 0; i < o.length; i++) { s += o[i] * o[i]; const d = o[i] - r[i]; e += d * d; }
  }
  if (e === 0) return Infinity;
  if (s === 0) return -Infinity;
  return 10 * Math.log10(s / e);
}

/** Resíduo exacto: pai - soma(filhos). Mantém a soma das folhas igual à pista mãe. */
export function residualOf(parentData, childDatas) {
  const L = Float32Array.from(parentData[0]), R = Float32Array.from(parentData[1]);
  for (const d of childDatas) for (let i = 0; i < L.length; i++) { L[i] -= d[0][i]; R[i] -= d[1][i]; }
  return [L, R];
}

export function peakOf(data) {
  let p = 0;
  for (const ch of data) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; }
  return p;
}
