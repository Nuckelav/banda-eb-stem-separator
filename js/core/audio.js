// Descodificação para estéreo 44,1 kHz (taxa de trabalho dos modelos) sem alterar duração nem tom.

export const WORK_RATE = 44100;

export async function decodeFile(file) {
  const arr = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: WORK_RATE });
  try {
    const buf = await ctx.decodeAudioData(arr.slice(0));
    const L = Float32Array.from(buf.getChannelData(0));
    const R = buf.numberOfChannels > 1 ? Float32Array.from(buf.getChannelData(1)) : Float32Array.from(L);
    return { stereo: [L, R], sampleRate: buf.sampleRate, channels: buf.numberOfChannels, duration: buf.duration };
  } finally { ctx.close(); }
}

export async function sha256Hex(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function stats(stereo) {
  let peak = 0, sum = 0; const n = stereo[0].length;
  for (const ch of stereo) for (let i = 0; i < n; i++) { const a = ch[i]; const m = Math.abs(a); if (m > peak) peak = m; sum += a * a; }
  const rms = Math.sqrt(sum / (n * 2));
  return { peakDb: 20 * Math.log10(peak || 1e-9), rmsDb: 20 * Math.log10(rms || 1e-9), clipped: peak >= 0.999 };
}
