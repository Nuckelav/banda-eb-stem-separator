// Reprodução multipista sincronizada (Web Audio). Todas as fontes arrancam no mesmo instante
// e com o mesmo offset, partilhando o relógio do AudioContext: sem atrasos entre pistas.

import { leaves } from './tracks.js';

export class Player {
  constructor(rate) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: rate });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.buffers = new Map();
    this.nodes = new Map();      // id -> {src, gain}
    this.tracks = []; this.duration = 0;
    this.monitor = 'mix';        // 'mix' | 'original'
    this.only = null;            // id de pista a ouvir isoladamente
    this.playing = false; this.offset = 0; this.startedAt = 0;
    this.onEnded = null;
  }

  _buf(data) {
    const b = this.ctx.createBuffer(2, data[0].length, this.ctx.sampleRate);
    b.copyToChannel(data[0], 0); b.copyToChannel(data[1], 1);
    return b;
  }

  load(tracks, original) {
    this.stop();
    this.tracks = tracks;
    this.buffers.clear();
    this.buffers.set('__original', this._buf(original));
    for (const t of tracks) this.buffers.set(t.id, this._buf(t.data));
    this.duration = this.buffers.get('__original').duration;
    this.offset = 0;
  }

  gainFor(t) {
    if (this.monitor === 'original') return 0;
    if (this.only) return t.id === this.only ? t.volume : 0;
    const lv = leaves(this.tracks);
    if (!lv.includes(t)) return 0;                    // grupos-mãe não entram na mistura
    if (t.muted) return 0;
    const anySolo = lv.some(x => x.solo);
    return anySolo && !t.solo ? 0 : t.volume;
  }

  applyGains() {
    const now = this.ctx.currentTime;
    for (const [id, n] of this.nodes) {
      const g = id === '__original' ? (this.monitor === 'original' ? 1 : 0) : this.gainFor(this.tracks.find(t => t.id === id));
      n.gain.gain.setTargetAtTime(g, now, 0.01);
    }
  }

  setMaster(v) { this.master.gain.value = v; }

  position() { return this.playing ? Math.min(this.duration, this.ctx.currentTime - this.startedAt) : this.offset; }

  async play(from = this.offset, only = this.only) {
    if (!this.tracks.length) return;
    await this.ctx.resume();
    this._stopSources();
    this.only = only;
    const when = this.ctx.currentTime + 0.05;       // mesmo "when" para todas as fontes
    const start = (id, initGain) => {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers.get(id);
      const gain = this.ctx.createGain(); gain.gain.value = initGain;
      src.connect(gain).connect(this.master);
      src.start(when, from);
      this.nodes.set(id, { src, gain });
      return src;
    };
    const first = start('__original', this.monitor === 'original' ? 1 : 0);
    for (const t of this.tracks) start(t.id, this.gainFor(t));
    first.onended = () => { if (this.playing && this.position() >= this.duration - 0.05) { this.stop(); this.onEnded?.(); } };
    this.startedAt = when - from; this.playing = true;
  }

  _stopSources() {
    for (const { src } of this.nodes.values()) { src.onended = null; try { src.stop(); } catch { /* já parada */ } src.disconnect(); }
    this.nodes.clear();
  }

  pause() { if (!this.playing) return; this.offset = this.position(); this._stopSources(); this.playing = false; }
  stop() { this._stopSources(); this.playing = false; this.offset = 0; this.only = null; }
  async seek(t) {
    t = Math.max(0, Math.min(this.duration, t));
    if (this.playing) await this.play(t, this.only); else this.offset = t;
  }
  setMonitor(m) { this.monitor = m; this.applyGains(); }
}
