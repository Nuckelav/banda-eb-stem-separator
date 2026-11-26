// Reprodução multipista sincronizada (Web Audio): volume, pan, solo/mute, velocidade e tom independentes,
// loop A-B, metrónomo e contagem. Todas as fontes arrancam com o mesmo "when" e offset: sem atrasos entre pistas.
// A posição pública está sempre em "tempo da música" (segundos do original), independente da velocidade.

import { leaves } from './tracks.js';
import { processStereo } from './stretch.js';

export class Player {
  constructor(rate) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: rate });
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.base = new Map(); this.cache = new Map(); this.buffers = this.base;
    this.nodes = new Map();
    this.tracks = []; this.duration = 0;
    this.monitor = 'mix'; this.only = null;
    this.playing = false; this.offset = 0; this.startedAt = 0; this.startWhen = 0;
    this.speed = 1; this.semis = 0;
    this.loop = { a: 0, b: 0, on: false };
    this.met = { on: false, bpm: 0, offset: 0, vol: 0.6, countIn: 0, perBar: 4 };
    this.lastBeat = -1; this.lastPos = 0; this.timer = null;
    this.onEnded = null;
  }

  _buf(data) { const b = this.ctx.createBuffer(2, data[0].length, this.ctx.sampleRate); b.copyToChannel(data[0], 0); b.copyToChannel(data[1], 1); return b; }

  load(tracks, original) {
    this.stop(); this.tracks = tracks; this.base.clear(); this.cache.clear(); this.src = new Map();
    this.src.set('__original', original); this.base.set('__original', this._buf(original));
    for (const t of tracks) { this.src.set(t.id, t.data); this.base.set(t.id, this._buf(t.data)); }
    this.duration = this.base.get('__original').duration; this.buffers = this.base;
    this.speed = 1; this.semis = 0; this.offset = 0;
  }

  /** Recalcula as pistas para nova velocidade/tom (processamento local, com progresso). */
  async setTempoPitch(speed, semis, onProgress) {
    const wasPlaying = this.playing, pos = this.position(); this.pause();
    const key = `${speed}|${semis}`;
    if (speed === 1 && semis === 0) this.buffers = this.base;
    else {
      if (!this.cache.has(key)) {
        const m = new Map(), ids = [...this.src.keys()];
        for (let i = 0; i < ids.length; i++) {
          const out = await processStereo(this.src.get(ids[i]), speed, semis, p => onProgress?.((i + p) / ids.length));
          m.set(ids[i], this._buf(out));
        }
        this.cache.clear(); this.cache.set(key, m);   // guarda só a última combinação (memória)
      }
      this.buffers = this.cache.get(key);
    }
    this.speed = speed; this.semis = semis; this.offset = pos;
    onProgress?.(1);
    if (wasPlaying) await this.play(pos, this.only);
  }

  gainFor(t) {
    if (this.monitor === 'original') return 0;
    if (this.only) return t.id === this.only ? t.volume : 0;
    const lv = leaves(this.tracks);
    if (!lv.includes(t) || t.muted) return 0;
    return lv.some(x => x.solo) && !t.solo ? 0 : t.volume;
  }

  applyGains() {
    const now = this.ctx.currentTime;
    for (const [id, n] of this.nodes) {
      if (id === '__original') { n.gain.gain.setTargetAtTime(this.monitor === 'original' ? 1 : 0, now, 0.01); continue; }
      const t = this.tracks.find(x => x.id === id);
      n.gain.gain.setTargetAtTime(this.gainFor(t), now, 0.01);
      if (n.pan) n.pan.pan.setTargetAtTime(t.pan || 0, now, 0.01);
    }
  }
  setMaster(v) { this.master.gain.value = v; }

  setLoop(a, b, on) {
    this.loop = { a, b, on: on && b > a };
    if (this.playing) { const p = this.position(); this.play(p, this.only, false); }
  }
  setMetronome(patch) { Object.assign(this.met, patch); this.lastBeat = -1; }

  position() {
    if (!this.playing) return this.offset;
    const now = this.ctx.currentTime;
    if (now < this.startWhen) return this.fromSong;           // durante a contagem
    let t = now - this.startedAt;                              // segundos de reprodução (processados)
    if (this.loop.on) {
      const la = this.loop.a / this.speed, lb = this.loop.b / this.speed;
      if (this.fromSong / this.speed < lb && t >= lb) t = la + ((t - la) % (lb - la));
    }
    return Math.min(this.duration, t * this.speed);
  }

  async play(from = this.offset, only = this.only, countIn = true) {
    if (!this.tracks.length) return;
    await this.ctx.resume(); this._stopSources(); this.only = only;
    const now = this.ctx.currentTime + 0.05;
    const beatProc = this.met.bpm ? 60 / (this.met.bpm * this.speed) : 0;
    const nCount = countIn && this.met.countIn && beatProc ? this.met.countIn : 0;
    for (let i = 0; i < nCount; i++) this._click(now + i * beatProc, i % this.met.perBar === 0);
    const when = now + nCount * beatProc;
    const offProc = from / this.speed;
    const mk = (id, g) => {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers.get(id);
      if (this.loop.on) { src.loop = true; src.loopStart = this.loop.a / this.speed; src.loopEnd = this.loop.b / this.speed; }
      const gain = this.ctx.createGain(); gain.gain.value = g;
      const t = id === '__original' ? null : this.tracks.find(x => x.id === id);
      const pan = t ? this.ctx.createStereoPanner() : null; if (pan) pan.pan.value = t.pan || 0;
      if (pan) src.connect(gain).connect(pan).connect(this.master); else src.connect(gain).connect(this.master);
      src.start(when, offProc); this.nodes.set(id, { src, gain, pan }); return src;
    };
    const first = mk('__original', this.monitor === 'original' ? 1 : 0);
    for (const t of this.tracks) mk(t.id, this.gainFor(t));
    first.onended = () => { if (this.playing && !this.loop.on && this.position() >= this.duration - 0.05) { this.stop(); this.onEnded?.(); } };
    this.startWhen = when; this.fromSong = from; this.startedAt = when - offProc; this.playing = true;
    this.lastBeat = Math.floor((from - this.met.offset) / (60 / (this.met.bpm || 1)) - 1e-6); this.lastPos = from;
    clearInterval(this.timer); this.timer = setInterval(() => this._metTick(), 25);
  }

  _click(at, accent) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000; o.type = 'square';
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(Math.max(0.001, this.met.vol * 0.5), at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    o.connect(g).connect(this.ctx.destination); o.start(at); o.stop(at + 0.06);
  }

  _metTick() {
    if (!this.playing || !this.met.on || !this.met.bpm) return;
    const now = this.ctx.currentTime; if (now < this.startWhen) return;
    const s = this.position(), period = 60 / this.met.bpm;
    if (s < this.lastPos - 0.2) this.lastBeat = Math.floor((s - this.met.offset) / period - 1e-6);   // salto do loop
    this.lastPos = s;
    const ahead = 0.12 * this.speed;
    for (let k = this.lastBeat + 1; this.met.offset + k * period < s + ahead; k++) {
      const bs = this.met.offset + k * period; this.lastBeat = k;
      if (bs < s - 0.01 || bs < 0) continue;
      this._click(now + (bs - s) / this.speed, ((k % this.met.perBar) + this.met.perBar) % this.met.perBar === 0);
    }
  }

  _stopSources() {
    for (const { src } of this.nodes.values()) { src.onended = null; try { src.stop(); } catch { /* já parada */ } src.disconnect(); }
    this.nodes.clear(); clearInterval(this.timer);
  }

  pause() { if (!this.playing) return; this.offset = this.position(); this._stopSources(); this.playing = false; }
  stop() { this._stopSources(); this.playing = false; this.offset = this.loop.on ? this.loop.a : 0; this.only = null; }
  async seek(t) { t = Math.max(0, Math.min(this.duration, t)); if (this.playing) await this.play(t, this.only, false); else this.offset = t; }
  setMonitor(m) { this.monitor = m; this.applyGains(); }
}
