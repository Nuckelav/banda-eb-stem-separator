// Registo de motores e capacidades. Reflete o que foi verificado nos repositórios e nos cartões dos modelos.
// Os URLs são editáveis na interface (Motores e modelos) e ficam guardados no navegador do utilizador.

const HF = 'https://huggingface.co';

export const DEFAULT_ENGINES = [
  {
    id: 'htdemucs4', role: 'base', label: 'HTDemucs v4 (4 pistas)',
    url: `${HF}/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx`,
    verified: 'Entrada/saída documentadas no cartão do modelo; ainda não executado de ponta a ponta neste projeto.',
    license: 'MIT (código Demucs e pesos). Atribuição pedida: Rouard, Massa, Défossez (ICASSP 2023).',
    size: '~166 MB (fp16 armazenado)',
    segment: 343980, overlap: 86000, normalize: false,
    io: { input: 'mix', output: 'stems' },
    stems: [
      { key: 'drums', name: 'Bateria (conjunto)', category: 'Bateria' },
      { key: 'bass', name: 'Baixo', category: 'Cordas' },
      { key: 'other', name: 'Outros instrumentos', category: 'Outros', note: 'Guitarras, teclados, metais e restantes instrumentos ainda misturados.' },
      { key: 'vocals', name: 'Voz (mistura vocal)', category: 'Vocais', note: 'Voz principal, backing e coros ainda juntos.' },
    ],
  },
  {
    id: 'htdemucs6', role: 'base', label: 'HTDemucs v4 (6 pistas: guitarra e piano)',
    url: `${HF}/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s.onnx`,
    verified: 'Nome do ficheiro NÃO confirmado (o cartão não lista URL nem tensores). Confirme o URL antes de usar.',
    license: 'MIT (código Demucs). Licença dos pesos 6s por confirmar no cartão do modelo.',
    size: 'por confirmar',
    segment: 343980, overlap: 86000, normalize: false,
    io: { input: 'mix', output: 'stems' },
    stems: [
      { key: 'drums', name: 'Bateria (conjunto)', category: 'Bateria' },
      { key: 'bass', name: 'Baixo', category: 'Cordas' },
      { key: 'other', name: 'Outros instrumentos', category: 'Outros' },
      { key: 'vocals', name: 'Voz (mistura vocal)', category: 'Vocais', note: 'Voz principal, backing e coros ainda juntos.' },
      { key: 'guitar', name: 'Guitarra', category: 'Cordas' },
      { key: 'piano', name: 'Piano', category: 'Teclados', note: 'Os autores do Demucs indicam que a pista de piano do modelo 6s é fraca.' },
    ],
  },
  {
    id: 'drumsep', role: 'split', inputFrom: 'drums', type: 'hybrid-cac', label: 'DrumSep v2 (bateria em 4 peças)',
    url: `${HF}/b33zy/drumsep-v2-onnx/resolve/main/drumsep_v2_w10_f16w.onnx`,
    sha256: 'b05779ea756870f3fe359c63ac501dd12caf3b24d66237b1404bb4dd5b32839a',
    verified: 'Entradas (mix, mag) e janela de 10 s retiradas do cartão do modelo; a STFT/iSTFT em JavaScript está testada, mas o modelo real ainda não foi executado de ponta a ponta. A origem dos dados de treino não está verificada pelo autor do export.',
    license: 'MIT (export b33zy, fine-tune gridshiftstudio de inagoy/drumsep, base Demucs/Meta). O cartão avisa que a proveniência dos dados de treino NÃO está verificada: confirme antes de uso comercial.',
    size: '~168 MB (fp16 armazenado)',
    segment: 441000, overlap: 110250, normalize: false,
    io: { input: 'mix', spec: 'mag', freq: 'freq_out', time: 'time_out' },
    // Ordem indicada no cartão do modelo: kick, snare, cymbals, toms.
    stems: [
      { key: 'kick', name: 'Kick / Bombo', category: 'Bateria' },
      { key: 'snare', name: 'Snare / Caixa', category: 'Bateria' },
      { key: 'cymbals', name: 'Cymbals / Pratos', category: 'Bateria', note: 'Hi-hat, crash e ride juntos neste modelo.' },
      { key: 'toms', name: 'Toms', category: 'Bateria' },
    ],
  },
];

// Capacidades pedidas vs. estado real. "engine" indica qual o motor que a poderia fornecer.
export const CAPABILITIES = [
  { group: 'Bateria', item: 'Kick, Snare, Toms, Cymbals', engine: 'drumsep' },
  { group: 'Bateria', item: 'Hi-hat fechado/aberto, Crash, Ride, Rimshot, Floor tom', engine: null, why: 'Os modelos abertos para navegador só dão "pratos" juntos. LarsNet (separa hi-hat) tem pesos CC BY-NC 4.0 e o modelo Timbrica é CC BY-NC-SA 4.0: uso não comercial apenas, por isso não estão ativos.' },
  { group: 'Percussão', item: 'Congas, bongôs, shakers, pandeiro e outras', engine: null, why: 'Sem modelo aberto verificado.' },
  { group: 'Cordas', item: 'Baixo', engine: 'base' },
  { group: 'Cordas', item: 'Guitarra (sem distinguir base/solo/acústica/elétrica)', engine: 'htdemucs6' },
  { group: 'Cordas', item: 'Contrabaixo, guitarra solo/base/acústica', engine: null, why: 'Sem modelo aberto verificado.' },
  { group: 'Teclados', item: 'Piano (fraco no modelo 6s)', engine: 'htdemucs6' },
  { group: 'Teclados', item: 'Órgão, sintetizadores, pads', engine: null, why: 'Sem modelo aberto verificado.' },
  { group: 'Metais e sopros', item: 'Saxofone, trompete, trombone, trompa, tuba', engine: null, why: 'Sem modelo aberto verificado.' },
  { group: 'Vocais', item: 'Voz (mistura vocal)', engine: 'base' },
  { group: 'Vocais', item: 'Voz principal vs. backing/coros', engine: null, why: 'Existe um RoFormer "karaoke" em ONNX, mas com ~875 MB não cabe num separador de navegador. Sem alternativa leve verificada.' },
];
