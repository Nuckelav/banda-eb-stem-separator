// Orquestração em etapas: motor base -> motores especializados sobre pistas-mãe.
// Cada motor só trabalha na pista para a qual está configurado (inputFrom).
// Nada é simulado: se um motor falha ou não está configurado, a etapa é reportada como tal.

import { newTrack, residualOf, peakOf } from './tracks.js';

const SILENCE_PEAK = 1e-4;

export async function runPipeline({ stereo, fileKey, configs, createEngine, store, onStage, onProgress, signal }) {
  const tracks = [];
  const report = [];
  const cached = new Set();
  const base = configs.find(c => c.role === 'base');
  if (!base) throw new Error('Nenhum motor base configurado.');

  const produce = async (cfg, input, label) => {
    const cacheKey = `${fileKey}|${cfg.id}|${cfg.url}|${label}`;
    let result = await store?.get(cacheKey);
    if (result) { cached.add(cfg.id); return result; }
    onStage?.(`${cfg.label}: a carregar modelo`);
    const engine = createEngine(cfg);
    try {
      await engine.load(p => onProgress?.(cfg.id, 'load', p));
      onStage?.(`${cfg.label}: a separar`);
      result = await engine.separate(input, p => onProgress?.(cfg.id, 'run', p), signal);
    } finally { engine.dispose?.(); }
    await store?.set(cacheKey, result);
    return result;
  };

  // Etapa 1: motor base sobre a mistura completa
  const baseOut = await produce(base, stereo, 'mix');
  base.stems.forEach((s, i) => {
    tracks.push(newTrack({ key: s.key, name: s.name, category: s.category, data: baseOut[i], engine: base.id, note: s.note || '' }));
  });
  report.push({ engine: base.id, status: cached.has(base.id) ? 'cache' : 'ok', message: `${base.stems.length} pistas${cached.has(base.id) ? ' (resultado reutilizado, sem recalcular)' : ''}` });

  // Etapas seguintes: especialistas
  for (const cfg of configs.filter(c => c.role === 'split')) {
    const parent = tracks.find(t => t.key === cfg.inputFrom && !tracks.some(c => c.parent === t.id));
    if (!parent) { report.push({ engine: cfg.id, status: 'ignorado', message: `Sem pista de entrada "${cfg.inputFrom}"` }); continue; }
    if (peakOf(parent.data) < SILENCE_PEAK) { report.push({ engine: cfg.id, status: 'ignorado', message: 'Pista de entrada silenciosa' }); continue; }
    try {
      const out = await produce(cfg, parent.data, parent.id);
      const kids = cfg.stems.map((s, i) => newTrack({ key: s.key, name: s.name, category: s.category, data: out[i], parent: parent.id, engine: cfg.id, note: s.note || '' }));
      kids.forEach(k => tracks.push(k));
      // Resíduo exacto: a soma das folhas continua igual à pista-mãe (sem duplicar nem perder energia).
      const res = residualOf(parent.data, kids.map(k => k.data));
      tracks.push(newTrack({ key: `${parent.key}-residuo`, name: `${parent.name} (resíduo)`, category: parent.category, data: res, parent: parent.id, engine: cfg.id, note: 'O que o modelo especializado não atribuiu a nenhuma peça.' }));
      report.push({ engine: cfg.id, status: cached.has(cfg.id) ? 'cache' : 'ok', message: `${kids.length} pistas a partir de "${parent.name}"${cached.has(cfg.id) ? ' (resultado reutilizado)' : ''}` });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      report.push({ engine: cfg.id, status: 'falhou', message: String(e?.message || e) });
    }
  }
  return { tracks, report };
}
