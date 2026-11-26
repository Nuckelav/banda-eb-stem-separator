// Codificador WAV (PCM 16/24 bits ou float 32 bits), estéreo ou mono.

export function encodeWav(channels, sampleRate, bitDepth = 24) {
  const nCh = channels.length;
  const n = channels[0].length;
  const isFloat = bitDepth === 32;
  const bytes = bitDepth / 8;
  const dataSize = n * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, isFloat ? 3 : 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * bytes, true);
  v.setUint16(32, nCh * bytes, true);
  v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);

  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = channels[c][i];
      if (isFloat) { v.setFloat32(o, x, true); o += 4; continue; }
      const s = Math.max(-1, Math.min(1, x));
      if (bitDepth === 16) {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
      } else {
        const q = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3;
      }
    }
  }
  return new Uint8Array(buf);
}

export function decodeWavHeader(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return {
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    sampleRate: v.getUint32(24, true),
    bitDepth: v.getUint16(34, true),
    dataSize: v.getUint32(40, true),
  };
}
