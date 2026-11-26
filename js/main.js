import { DEFAULT_ENGINES, CAPABILITIES } from './models.js';
import { decodeFile, sha256Hex, stats, WORK_RATE } from './core/audio.js';
import { createEngine, hasWebGPU } from './core/engines.js';
import { runPipeline } from './core/pipeline.js';
import { planChunks } from './core/overlap.js';
import { idbStore } from './core/store.js';
import { Player } from './core/player.js';
import { computePeaks, drawWave, drawRuler, fmtTime } from './core/waveform.js';
import { encodeWav } from './core/wav.js';
import { makeZip } from './core/zip.js';
import { CATEGORIES, mixDown, leaves, snrDb } from './core/tracks.js';
import { detectTempo, monoOf, chromagram, detectChords, detectKey, transposeName, NOTE } from './core/analysis.js';

const $ = id => document.getElementById(id);
const COLORS = { Bateria: '#ff5a4d', Percussão: '#ffb454', Cordas: '#f3f3f3', Teclados: '#ff9fb0', 'Metais e sopros': '#d9a066', Vocais: '#ff2e3f', Outros: '#8f8f8f' };
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6h12v12H6z" fill="currentColor"/></svg>',
  dl: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---------- estado ----------
const S = {
  file: null, fileKey: null, dec: null, tracks: [], report: [], peaks: new Map(), player: null,
  view: { start: 0, pxPerSec: 50, zoom: 0 }, chords: [], key: null, tempo: null, loop: { a: 0, b: 0, on: false }, abort: null, webgpu: false, lastRun: null,
  cfg: loadCfg(),
};

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('banda-eb-engines') || '{}'); } catch { /* ignora */ }
  const engines = DEFAULT_ENGINES.map(e => ({ ...e, url: saved[e.id]?.url ?? e.url, sha256: (saved[e.id]?.url ?? e.url) === e.url ? e.sha256 : undefined, enabled: saved[e.id]?.enabled ?? (e.id === 'htdemucs4' || e.id === 'drumsep') }));
  return { engines, base: saved.__base || 'htdemucs4' };
}
function saveCfg() {
  const o = { __base: S.cfg.base };
  S.cfg.engines.forEach(e => o[e.id] = { url: e.url, enabled: e.enabled });
  try { localStorage.setItem('banda-eb-engines', JSON.stringify(o)); } catch { /* ignora */ }
}
function activeConfigs() {
  const base = S.cfg.engines.find(e => e.id === S.cfg.base);
  const splits = S.cfg.engines.filter(e => e.role === 'split' && e.enabled && e.url);
  return [base, ...splits];
}

// ---------- ambiente ----------
hasWebGPU().then(ok => { S.webgpu = ok; const p = $('envGpu'); p.textContent = ok ? 'WebGPU disponível' : 'WebGPU indisponível (WebAssembly, mais lento)'; p.classList.toggle('ok', ok); });

// ---------- carregar ficheiro ----------
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) setFile(f); });
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('file').addEventListener('change', e => { if (e.target.files[0]) setFile(e.target.files[0]); });

function setFile(f) {
  S.file = f; S.dec = null; S.fileKey = null; S.tracks = []; S.report = [];
  $('dropTitle').textContent = f.name;
  $('dropSub').textContent = `${(f.size / 1048576).toFixed(1)} MB`;
  $('btnAnalyze').disabled = false; $('btnSeparate').disabled = false;
  $('analysis').hidden = true; $('progressBox').hidden = true;
  teardownStudio(); renderInstruments();
}

async function ensureDecoded() {
  if (S.dec) return;
  setProgress('A descodificar áudio', 0.02);
  S.dec = await decodeFile(S.file);
  S.fileKey = await sha256Hex(S.file);
}

// ---------- analisar ----------
$('btnAnalyze').addEventListener('click', async () => {
  try {
    busy(true); $('progressBox').hidden = false; $('report').innerHTML = '';
    await ensureDecoded();
    const st = stats(S.dec.stereo);
    const cfgs = activeConfigs();
    const base = cfgs[0];
    const chunks = planChunks(S.dec.stereo[0].length, base.segment, base.overlap).length;
    const nStems = cfgs.reduce((a, c) => a + c.stems.length, 0);
    const memMB = (nStems * 2 * 4 * S.dec.stereo[0].length) / 1048576;
    const a = $('analysis'); a.hidden = false; a.replaceChildren();
    const add = (k, v, cls) => { const d = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; if (cls) dd.className = cls; d.append(dt, dd); a.append(d); };
    add('Duração', fmtTime(S.dec.duration, true));
    add('Canais originais', S.dec.channels === 1 ? 'Mono (duplicado para estéreo)' : String(S.dec.channels));
    add('Taxa de trabalho', `${WORK_RATE} Hz (reamostrado só se necessário)`);
    add('Pico / RMS', `${st.peakDb.toFixed(1)} dBFS / ${st.rmsDb.toFixed(1)} dBFS`, st.clipped ? 'warn' : '');
    add('Segmentos de inferência', `${chunks} x ${(base.segment / WORK_RATE).toFixed(1)} s`);
    add('Memória estimada dos resultados', `~${memMB.toFixed(0)} MB`);
    add('Aceleração', S.webgpu ? 'WebGPU' : 'WebAssembly (CPU)');
    add('Motores ativos', cfgs.map(c => c.label).join(' + '));
    const note = document.createElement('div'); note.className = 'note';
    note.textContent = (st.clipped ? 'Aviso: o ficheiro tem picos em 0 dBFS (possível clipping); a separação pode ter artefactos. ' : '') +
      'O tempo de processamento depende do dispositivo e só é medido depois da primeira execução.';
    a.append(note);
  } catch (e) { fail(e); } finally { busy(false); $('progressBox').hidden = true; }
});

// ---------- separar ----------
$('btnSeparate').addEventListener('click', async () => {
  S.abort = new AbortController();
  try {
    busy(true); $('progressBox').hidden = false; $('report').innerHTML = '';
    await ensureDecoded();
    teardownStudio();
    const cfgs = activeConfigs();
    const t0 = performance.now();
    const res = await runPipeline({
      stereo: S.dec.stereo, fileKey: S.fileKey, configs: cfgs, createEngine, store: idbStore, signal: S.abort.signal,
      onStage: msg => setProgress(msg, null),
      onProgress: (id, phase, p) => { const e = cfgs.find(c => c.id === id); setProgress(`${e.label}: ${phase === 'load' ? 'a descarregar/carregar modelo' : 'a separar'}`, p); },
    });
    S.tracks = res.tracks; S.report = res.report;
    S.lastRun = ((performance.now() - t0) / 1000).toFixed(1);
    renderReport(); buildStudio(); renderInstruments();
    setProgress(`Concluído em ${S.lastRun} s`, 1);
  } catch (e) { if (e?.name === 'AbortError') setProgress('Cancelado', null); else fail(e); }
  finally { busy(false); S.abort = null; }
});
$('btnCancel').addEventListener('click', () => S.abort?.abort());

function busy(b) {
  $('btnAnalyze').disabled = b || !S.file; $('btnSeparate').disabled = b || !S.file; $('btnCancel').hidden = !(b && S.abort);
}
function setProgress(text, p) {
  $('progressText').textContent = text;
  if (p != null) { $('progressBar').style.width = `${Math.round(p * 100)}%`; $('progressPct').textContent = `${Math.round(p * 100)}%`; }
}
function fail(e) {
  console.error(e); $('progressBox').hidden = false;
  setProgress(`Erro: ${e?.message || e}`, null);
}
function renderReport() {
  const ul = $('report'); ul.replaceChildren();
  for (const r of S.report) { const li = document.createElement('li'); li.className = r.status === 'cache' ? 'ok' : r.status; li.textContent = `${r.engine}: ${r.status} (${r.message})`; ul.append(li); }
}

// ---------- lista de instrumentos (estado real) ----------
function renderInstruments() {
  const root = $('instList'); root.replaceChildren();
  const produced = new Set(S.tracks.map(t => t.engine));
  const failed = new Set(S.report.filter(r => r.status === 'falhou').map(r => r.engine));
  const byGroup = {};
  CAPABILITIES.forEach(c => (byGroup[c.group] ||= []).push(c));
  for (const g of CATEGORIES) {
    if (!byGroup[g]) continue;
    const h = document.createElement('h3'); h.textContent = g; root.append(h);
    const ul = document.createElement('ul');
    for (const c of byGroup[g]) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = c.item;
      const tag = document.createElement('span'); tag.className = 'tag';
      let target = c.engine === 'base' ? S.cfg.base : c.engine;
      if (!c.engine) { tag.textContent = 'Sem modelo'; tag.classList.add('none'); }
      else if (produced.has(target)) { tag.textContent = 'Separado'; tag.classList.add('done'); }
      else if (failed.has(target)) { tag.textContent = 'Falhou'; tag.classList.add('fail'); }
      else {
        const e = S.cfg.engines.find(x => x.id === target);
        const configured = e && e.url && (e.role === 'base' ? S.cfg.base === e.id : e.enabled);
        tag.textContent = configured ? 'Disponível' : 'Não ativo'; tag.classList.add(configured ? 'ready' : 'none');
      }
      li.append(name, tag);
      if (!c.engine) { const s = document.createElement('small'); s.textContent = c.why; li.append(s); }
      ul.append(li);
    }
    root.append(ul);
  }
}

// ---------- estúdio ----------
function teardownStudio() {
  $('practice').hidden = true; S.chords = []; S.key = null; S.tempo = null; S.loop = { a: 0, b: 0, on: false };
  S.player?.stop(); S.player?.ctx.close(); S.player = null; S.peaks.clear();
  $('tracks').querySelectorAll('.track').forEach(n => n.remove());
  $('studioBody').hidden = true; $('studioEmpty').hidden = false;
  ['tPlay', 'tStop', 'abMix', 'abOrig', 'btnExportAll', 'btnExportMix'].forEach(id => $(id).disabled = true);
  $('tTime').textContent = '0:00 / 0:00';
}

function buildStudio() {
  const dur = S.dec.duration;
  S.player = new Player(WORK_RATE);
  S.player.load(S.tracks, S.dec.stereo);
  S.player.onEnded = () => { $('tPlay').innerHTML = ICON.play; };
  $('studioEmpty').hidden = true; $('studioBody').hidden = false;
  ['tPlay', 'tStop', 'abMix', 'abOrig', 'btnExportAll', 'btnExportMix'].forEach(id => $(id).disabled = false);
  $('tPlay').innerHTML = ICON.play; $('tStop').innerHTML = ICON.stop;

  const lv = new Set(leaves(S.tracks));
  const wrap = $('tracks');
  const ordered = [...S.tracks].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  for (const t of ordered) {
    const isLeaf = lv.has(t);
    S.peaks.set(t.id, computePeaks(t.data));
    const row = document.createElement('div'); row.className = 'track' + (isLeaf ? '' : ' group'); row.dataset.id = t.id;
    const head = document.createElement('div'); head.className = 'head';
    const nm = document.createElement('div'); nm.className = 'name';
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = COLORS[t.category];
    const inp = document.createElement('input'); inp.value = t.name; inp.setAttribute('aria-label', 'Nome da pista'); inp.title = t.note || 'Clique para renomear';
    inp.addEventListener('input', () => { t.name = inp.value; });
    nm.append(dot, inp);
    const btns = document.createElement('div'); btns.className = 'btns';
    const mk = (cls, html, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.innerHTML = html; b.title = title; b.addEventListener('click', () => fn(b)); return b; };
    const play = mk('p', ICON.play, 'Ouvir só esta pista', b => {
      const p = S.player; const was = p.only === t.id && p.playing;
      if (was) { p.pause(); p.only = null; } else { p.play(p.position(), t.id); }
      syncPlayButtons();
    });
    btns.append(play);
    if (isLeaf) {
      const solo = mk('s', 'S', 'Solo', b => { t.solo = !t.solo; b.classList.toggle('on', t.solo); S.player.applyGains(); });
      const mute = mk('m', 'M', 'Mute', b => { t.muted = !t.muted; b.classList.toggle('on', t.muted); S.player.applyGains(); });
      btns.append(solo, mute);
    }
    const dl = mk('d', ICON.dl + ' WAV', 'Descarregar WAV', () => download(`${safe(t.name)}.wav`, encodeWav(t.data, WORK_RATE, bitDepth())));
    btns.append(dl);
    head.append(nm, btns);
    if (isLeaf) {
      const vol = document.createElement('input'); vol.type = 'range'; vol.className = 'vol'; vol.min = 0; vol.max = 1.5; vol.step = 0.01; vol.value = 1; vol.setAttribute('aria-label', 'Volume da pista');
      vol.addEventListener('input', () => { t.volume = Number(vol.value); S.player.applyGains(); });
      const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.innerHTML = '<span>E</span><span>Pan</span><span>D</span>';
      const pan = document.createElement('input'); pan.type = 'range'; pan.className = 'pan'; pan.min = -1; pan.max = 1; pan.step = 0.05; pan.value = 0; pan.setAttribute('aria-label', 'Pan da pista (esquerda/direita)');
      pan.addEventListener('input', () => { t.pan = Number(pan.value); S.player.applyGains(); });
      pan.addEventListener('dblclick', () => { pan.value = 0; t.pan = 0; S.player.applyGains(); });
      head.append(vol, pan, lbl);
    } else { const m = document.createElement('span'); m.className = 'meta'; m.textContent = 'Grupo de referência (não entra na soma: já dividido em pistas abaixo)'; head.append(m); }
    const lane = document.createElement('div'); lane.className = 'lane';
    const cv = document.createElement('canvas'); lane.append(cv);
    cv.addEventListener('click', e => seekFromEvent(e, cv));
    row.append(head, lane); wrap.append(row);
  }
  setupView(dur);
  initPractice();
  redraw();
}

function syncPlayButtons() {
  const p = S.player;
  $('tPlay').innerHTML = p.playing && !p.only ? ICON.pause : ICON.play;
  document.querySelectorAll('.track .btns .p').forEach(b => { const id = b.closest('.track').dataset.id; const on = p.playing && p.only === id; b.classList.toggle('on', on); b.innerHTML = on ? ICON.pause : ICON.play; });
}

$('tPlay').addEventListener('click', async () => {
  const p = S.player; if (!p) return;
  if (p.playing && !p.only) p.pause(); else await p.play(p.position(), null);
  syncPlayButtons();
});
$('tStop').addEventListener('click', () => { S.player?.stop(); syncPlayButtons(); });
$('abMix').addEventListener('click', () => { S.player?.setMonitor('mix'); $('abMix').classList.add('on'); $('abOrig').classList.remove('on'); });
$('abOrig').addEventListener('click', () => { S.player?.setMonitor('original'); $('abOrig').classList.add('on'); $('abMix').classList.remove('on'); });
$('master').addEventListener('input', e => S.player?.setMaster(Number(e.target.value)));

// vista: zoom + navegação (só a janela visível é desenhada)
function laneWidth() { return document.querySelector('#studioBody .lane')?.clientWidth || 800; }
function setupView(dur) {
  S.view.zoom = 0; S.view.start = 0; S.view.pxPerSec = laneWidth() / dur; $('zoom').value = 0;
}
function applyZoom(z, anchorSec) {
  const dur = S.dec.duration, base = laneWidth() / dur;
  const old = S.view.pxPerSec; S.view.zoom = z; S.view.pxPerSec = base * Math.pow(2, z);
  const a = anchorSec ?? (S.view.start + laneWidth() / old / 2);
  S.view.start = a - (a - S.view.start) * old / S.view.pxPerSec;
  clampView(); redraw();
}
function clampView() {
  const vis = laneWidth() / S.view.pxPerSec;
  S.view.start = Math.max(0, Math.min(S.dec.duration - vis, S.view.start));
  if (vis >= S.dec.duration) S.view.start = 0;
}
$('zoom').addEventListener('input', e => applyZoom(Number(e.target.value)));
$('scroll').addEventListener('input', e => {
  const vis = laneWidth() / S.view.pxPerSec, span = Math.max(0, S.dec.duration - vis);
  S.view.start = span * Number(e.target.value) / 1000; redraw();
});
$('tracks').addEventListener('wheel', e => {
  if (!S.dec) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const rect = document.querySelector('#studioBody .lane').getBoundingClientRect();
    const sec = S.view.start + (e.clientX - rect.left) / S.view.pxPerSec;
    const z = Math.max(0, Math.min(6, S.view.zoom - e.deltaY * 0.003)); $('zoom').value = z; applyZoom(z, sec);
  } else { S.view.start += (e.deltaX || e.deltaY) / S.view.pxPerSec; clampView(); redraw(); }
}, { passive: false });
const rulerSec = e => { const r = $('ruler').getBoundingClientRect(); return Math.max(0, Math.min(S.dec.duration, S.view.start + (e.clientX - r.left) / S.view.pxPerSec)); };
$('ruler').addEventListener('pointerdown', e => {
  if (!S.player) return; const a = rulerSec(e); let moved = false; $('ruler').setPointerCapture(e.pointerId);
  const mv = ev => { const b = rulerSec(ev); if (Math.abs(b - a) * S.view.pxPerSec > 4) { moved = true; setLoop(Math.min(a, b), Math.max(a, b), true); } };
  const up = ev => { $('ruler').removeEventListener('pointermove', mv); $('ruler').removeEventListener('pointerup', up); if (!moved) S.player.seek(a).then(() => tick(true)); };
  $('ruler').addEventListener('pointermove', mv); $('ruler').addEventListener('pointerup', up);
});
window.addEventListener('themechange', () => { if (S.dec && S.tracks.length) redraw(); });
window.addEventListener('resize', () => { if (S.dec && S.tracks.length) applyZoom(S.view.zoom); });

function seekFromEvent(e, cv) {
  const r = cv.getBoundingClientRect();
  S.player.seek(S.view.start + (e.clientX - r.left) / S.view.pxPerSec).then(() => tick(true));
}

function redraw() {
  if (!S.dec) return;
  drawRuler($('ruler'), S.view.start, S.view.pxPerSec, S.dec.duration);
  document.querySelectorAll('.track').forEach(row => {
    const t = S.tracks.find(x => x.id === row.dataset.id);
    drawWave(row.querySelector('canvas'), S.peaks.get(t.id), WORK_RATE, S.view.start, S.view.pxPerSec, COLORS[t.category]);
  });
  const vis = laneWidth() / S.view.pxPerSec, span = S.dec.duration - vis;
  $('scroll').disabled = span <= 0; $('scroll').value = span > 0 ? Math.round(S.view.start / span * 1000) : 0;
  drawChords(); placeLoop(); tick(true);
}

function tick(once) {
  const p = S.player; if (!p) return;
  const pos = p.position();
  const head = document.querySelector('#studioBody .head');
  const x = (head?.offsetWidth || 268) + (pos - S.view.start) * S.view.pxPerSec;
  const ph = $('playhead');
  const lane = document.querySelector('#studioBody .lane');
  ph.style.display = (pos >= S.view.start && x <= (head?.offsetWidth || 268) + (lane?.clientWidth || 0)) ? 'block' : 'none';
  ph.style.left = `${x}px`;
  $('tTime').textContent = `${fmtTime(pos)} / ${fmtTime(p.duration)}`;
  if (p.playing && S.view.pxPerSec * (p.duration) > laneWidth()) { // segue a cabeça de reprodução quando ampliado
    const vis = laneWidth() / S.view.pxPerSec;
    if (pos > S.view.start + vis * 0.95) { S.view.start = pos - vis * 0.1; clampView(); redraw(); return; }
  }
  if (!once && p.playing) requestAnimationFrame(() => tick(false));
}
setInterval(() => { if (S.player?.playing) requestAnimationFrame(() => tick(true)); }, 33);

// ---------- exportação ----------
const bitDepth = () => Number($('bitDepth').value);
const safe = s => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'pista';
function download(name, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'audio/wav' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const baseName = () => safe((S.file?.name || 'musica').replace(/\.[^.]+$/, ''));

$('btnExportAll').addEventListener('click', () => {
  try {
    const files = []; const used = new Set();
    const uniq = n => { let k = n, i = 2; while (used.has(k)) k = `${n} (${i++})`; used.add(k); return k; };
    for (const t of S.tracks) files.push({ name: `${uniq(`${t.category} - ${safe(t.name)}${leaves(S.tracks).includes(t) ? '' : ' [grupo]'}`)}.wav`, data: encodeWav(t.data, WORK_RATE, bitDepth()) });
    const rec = mixDown(S.tracks, S.dec.stereo[0].length);
    files.push({ name: 'MISTURA reconstruida.wav', data: encodeWav(rec, WORK_RATE, bitDepth()) });
    const snr = snrDb(S.dec.stereo, rec);
    files.push({ name: 'LEIA-ME.txt', data: new TextEncoder().encode(
      `BANDA EB AI STEM SEPARATOR\nFicheiro: ${S.file.name}\nTaxa: ${WORK_RATE} Hz, estéreo, duração ${S.dec.duration.toFixed(3)} s\n` +
      `Relação sinal/erro da mistura reconstruída vs. original: ${Number.isFinite(snr) ? snr.toFixed(1) + ' dB' : 'n/d'}\n` +
      `Pistas marcadas [grupo] são referência (já divididas noutras pistas) e não entram na mistura reconstruída.\n` +
      S.report.map(r => `${r.engine}: ${r.status} - ${r.message}`).join('\n') + '\n') });
    download(`${baseName()} - pistas.zip`, makeZip(files));
  } catch (e) { fail(e); }
});

$('btnExportMix').addEventListener('click', () => {
  const p = S.player;
  const mix = mixDown(S.tracks, S.dec.stereo[0].length, t => p.gainFor(t));
  download(`${baseName()} - mistura atual.wav`, encodeWav(mix, WORK_RATE, bitDepth()));
});

// ---------- motores e modelos ----------
const dlg = $('dlgEngines');
$('btnEngines').addEventListener('click', () => { renderEngines(); dlg.showModal(); });
dlg.addEventListener('close', () => { saveCfg(); renderInstruments(); });
$('btnClearCache').addEventListener('click', async () => { await idbStore.clear(); alert('Resultados guardados eliminados. Os modelos descarregados mantêm-se na cache do navegador.'); });

function renderEngines() {
  const root = $('engineRows'); root.replaceChildren();
  for (const e of S.cfg.engines) {
    const box = document.createElement('div'); box.className = 'eng';
    const header = document.createElement('header');
    const label = document.createElement('label');
    const ctl = document.createElement('input');
    if (e.role === 'base') { ctl.type = 'radio'; ctl.name = 'base'; ctl.checked = S.cfg.base === e.id; ctl.addEventListener('change', () => { S.cfg.base = e.id; }); }
    else { ctl.type = 'checkbox'; ctl.checked = e.enabled; ctl.addEventListener('change', () => { e.enabled = ctl.checked; }); }
    label.append(ctl, document.createTextNode(e.label));
    const role = document.createElement('span'); role.className = 'tag'; role.textContent = e.role === 'base' ? 'Motor base' : `Especialista sobre "${e.inputFrom}"`;
    header.append(label, role);
    const url = document.createElement('input'); url.type = 'text'; url.value = e.url; url.placeholder = 'URL do ficheiro .onnx (contrato: mix -> stems)'; url.setAttribute('aria-label', `URL do modelo ${e.label}`);
    url.addEventListener('input', () => { e.url = url.value.trim(); });
    const p1 = document.createElement('p'); p1.textContent = `Licença: ${e.license}  |  Tamanho: ${e.size}`;
    const p2 = document.createElement('p'); p2.className = 'warn'; p2.textContent = `Estado da verificação: ${e.verified}`;
    box.append(header, url, p1, p2); root.append(box);
  }
  const b = $('blockedRows'); b.replaceChildren();
  const items = [
    ['LarsNet / LARS (EdoardoMor/LARS)', 'Cinco peças de bateria (kick, snare, toms, hi-hat, pratos), mas os pesos são CC BY-NC 4.0 (não comercial) e o motor é PyTorch/LibTorch (plugin VST3/AU). Não integrado sem autorização dos autores.'],
    ['Stemmy (pgotta/Stemmy)', 'Aplicação de ambiente de trabalho para Windows (Python, PyTorch, CUDA, Flask). Licença MIT. Serviu de referência para o fluxo base + DrumSep, mas não corre no navegador.'],
    ['Stem Splitter (hmcelik/stem-splitter)', 'Aplicação Windows (PySide6) com modelos RoFormer, MDX23C e HTDemucs. Código MIT; cada modelo tem licença própria. Divide bateria em kick, snare, toms, hi-hat, ride e crash e voz em principal/backing, mas só em desktop com GPU NVIDIA. Não corre no navegador.'],
    ['Demucs (facebookresearch/demucs)', 'Base do motor integrado (HTDemucs). Repositório arquivado em jan. 2025; fork mantido em adefossez/demucs. Código MIT.'],
    ['Stem Studio (d-r-e/stem-studio), Stemyla, sdemux', 'Não consegui ler estes repositórios (limite de pedidos do GitHub), pelo que não afirmo nada sobre eles. Nenhum código foi reutilizado.'],
  ];
  for (const [t, d] of items) { const p = document.createElement('p'); const s = document.createElement('b'); s.textContent = t + ': '; p.append(s, document.createTextNode(d)); b.append(p); }
}

renderInstruments();


// ---------- funções de prática ----------
const fmtKey = (root, mode, semis = 0) => `${NOTE[(((root + semis) % 12) + 12) % 12]} ${mode === 'maj' ? 'maior' : 'menor'}`;

function initPractice() {
  const p = S.player;
  $('practice').hidden = false; $('speed').value = 100; $('pitch').value = 0; $('speedVal').textContent = '100%'; $('pitchVal').textContent = '0';
  $('metOn').checked = false; $('countIn').value = '0'; $('loopTxt').textContent = ''; $('loopOn').classList.remove('on'); $('procInfo').textContent = '';
  $('anaInfo').textContent = 'A analisar BPM, tom e acordes...'; $('bpm').value = '';
  p.setMetronome({ on: false, bpm: 0, offset: 0, countIn: 0 });
  runAnalysis().catch(e => { $('anaInfo').textContent = `Análise indisponível: ${e?.message || e}`; });
}

async function runAnalysis() {
  const len = S.dec.stereo[0].length, tracks = S.tracks;
  const drumMix = mixDown(tracks, len, t => t.category === 'Bateria' ? 1 : 0);
  let drumE = 0; for (let i = 0; i < len; i += 97) drumE += Math.abs(drumMix[0][i]);
  const tempoSrc = drumE > 1 ? drumMix : S.dec.stereo;
  await new Promise(r => setTimeout(r));
  S.tempo = detectTempo(monoOf(tempoSrc), WORK_RATE);
  const harm = mixDown(tracks, len, t => t.category === 'Bateria' ? 0 : 1);
  const frames = await chromagram(monoOf(harm), WORK_RATE);
  S.key = detectKey(frames);
  const seg = S.tempo ? Math.max(0.5, 2 * 60 / S.tempo.bpm) : 1.5;
  S.chords = detectChords(frames, S.dec.duration, seg);
  if (S.tempo) { $('bpm').value = S.tempo.bpm; S.player.setMetronome({ bpm: S.tempo.bpm, offset: S.tempo.offset }); }
  updateAnaInfo(); drawChords();
}

function updateAnaInfo() {
  const semis = S.player?.semis || 0;
  const k = S.key ? (semis ? `${fmtKey(S.key.root, S.key.mode)} → ${fmtKey(S.key.root, S.key.mode, semis)}` : fmtKey(S.key.root, S.key.mode)) : '—';
  $('anaInfo').textContent = `Tom estimado: ${k}  |  BPM estimado: ${S.tempo ? S.tempo.bpm : '—'} (ajustável)`;
}

let procTimer;
function applyTempoPitch() {
  clearTimeout(procTimer);
  const speed = Number($('speed').value) / 100, semis = Number($('pitch').value);
  $('speedVal').textContent = `${$('speed').value}%`; $('pitchVal').textContent = semis > 0 ? `+${semis}` : String(semis);
  procTimer = setTimeout(async () => {
    const p = S.player; if (!p) return;
    ['speed', 'pitch'].forEach(id => $(id).disabled = true);
    try { await p.setTempoPitch(speed, semis, v => { $('procInfo').textContent = v < 1 ? `A processar ${Math.round(v * 100)}%` : ''; }); }
    catch (e) { $('procInfo').textContent = `Erro: ${e?.message || e}`; }
    ['speed', 'pitch'].forEach(id => $(id).disabled = false);
    updateAnaInfo(); drawChords(); syncPlayButtons();
  }, 450);
}
$('speed').addEventListener('input', applyTempoPitch);
$('pitch').addEventListener('input', applyTempoPitch);

const metPatch = () => S.player?.setMetronome({ on: $('metOn').checked, vol: Number($('metVol').value), countIn: Number($('countIn').value), bpm: Number($('bpm').value) || 0, offset: S.tempo?.offset || 0 });
['metOn', 'metVol', 'countIn'].forEach(id => $(id).addEventListener('input', metPatch));
$('bpm').addEventListener('input', metPatch);

function setLoop(a, b, on) {
  S.loop = { a, b, on: on && b > a };
  S.player?.setLoop(a, b, S.loop.on);
  $('loopOn').classList.toggle('on', S.loop.on);
  $('loopTxt').textContent = b > a ? `${fmtTime(a, true)} – ${fmtTime(b, true)}` : (a ? `A ${fmtTime(a, true)}` : '');
  placeLoop();
}
$('loopA').addEventListener('click', () => { const t = S.player.position(); setLoop(t, S.loop.b > t ? S.loop.b : 0, S.loop.on && S.loop.b > t); });
$('loopB').addEventListener('click', () => { const t = S.player.position(); if (t > S.loop.a) setLoop(S.loop.a, t, true); });
$('loopOn').addEventListener('click', () => { if (S.loop.b > S.loop.a) setLoop(S.loop.a, S.loop.b, !S.loop.on); });
$('loopClr').addEventListener('click', () => setLoop(0, 0, false));

function placeLoop() {
  const box = $('loopBox'); if (!S.dec || !(S.loop.b > S.loop.a)) { box.style.display = 'none'; return; }
  const head = document.querySelector('#studioBody .head')?.offsetWidth || 268, w = laneWidth();
  const x0 = Math.max(0, (S.loop.a - S.view.start) * S.view.pxPerSec), x1 = Math.min(w, (S.loop.b - S.view.start) * S.view.pxPerSec);
  if (x1 <= 0 || x0 >= w) { box.style.display = 'none'; return; }
  box.style.display = 'block'; box.style.left = `${head + x0}px`; box.style.width = `${Math.max(2, x1 - x0)}px`; box.style.opacity = S.loop.on ? '1' : '.45';
}

function drawChords() {
  const cv = $('chordCv'); if (!cv || !S.dec || !S.chords.length) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement), semis = S.player?.semis || 0;
  g.font = '700 13px Inter, "Segoe UI", system-ui, sans-serif'; g.textBaseline = 'middle';
  for (const c of S.chords) {
    const x0 = (c.t0 - S.view.start) * S.view.pxPerSec, x1 = (c.t1 - S.view.start) * S.view.pxPerSec;
    if (x1 < 0 || x0 > w) continue;
    g.fillStyle = c.name ? cs.getPropertyValue('--soft') : 'transparent'; g.fillRect(x0 + 1, 3, Math.max(1, x1 - x0 - 2), h - 6);
    g.strokeStyle = cs.getPropertyValue('--line'); g.strokeRect(x0 + 1.5, 3.5, Math.max(1, x1 - x0 - 3), h - 7);
    if (x1 - x0 > 26 && c.name) { g.fillStyle = cs.getPropertyValue('--text'); g.fillText(transposeName(c.root, c.mode, semis), Math.max(x0, 0) + 6, h / 2); }
  }
}
