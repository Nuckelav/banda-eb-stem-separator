# BANDA EB AI STEM SEPARATOR

Estúdio de separação musical que corre inteiramente no navegador do visitante (ONNX Runtime Web, WebGPU com recuo para WebAssembly). Sem servidor de IA, sem API paga, sem créditos, sem envio de músicas.

Projeto estático, sem passo de compilação: HTML + módulos ES.

## Estado honesto

| Componente | Estado |
|---|---|
| Descodificação, segmentação, overlap-add, pipeline em etapas, resíduo exato, cache, WAV, ZIP, estúdio multipista | Implementado e testado (`node test/core.test.mjs`, 16 testes, mais um teste de browser com ORT simulado) |
| Separação 4 pistas (HTDemucs v4, ONNX) | Código real; URL e contrato de E/S vêm do cartão do modelo `StemSplitio/htdemucs-onnx`. **Não foi executado com o modelo real** (o ambiente de desenvolvimento não tinha rede) |
| 6 pistas (guitarra, piano) | Código real, mas o nome do ficheiro `.onnx` **não está confirmado**; edite o URL em "Motores e modelos" |
| Bateria em peças (kick, snare, pratos, toms) | Código real (especialista sobre a pista "bateria"), **desligado por omissão**: não encontrei export ONNX do DrumSep publicado. Cole o URL de um export com o contrato `mix -> stems [1,4,2,SEG]` e confirme a ordem das pistas em `js/models.js` |
| Hi-hat aberto/fechado, crash, ride, rimshot, floor tom | **Sem modelo** utilizável no navegador |
| Percussão (congas, bongôs...), guitarra solo/base, órgão, sintetizadores, metais, sopros | **Sem modelo** aberto verificado |
| Voz principal vs. backing/coros | **Sem modelo** com export para navegador verificado |
| FLAC | Não implementado (os navegadores não codificam FLAC de forma fiável). Exporta WAV 16/24/32 float |

A interface nunca mostra como "Separado" algo que um modelo não produziu, e uma etapa que falha é reportada como falhada.

## Como funciona

1. O ficheiro é descodificado para estéreo 44,1 kHz (taxa de trabalho dos modelos), sem alterar duração nem tom.
2. Motor base (HTDemucs) sobre a mistura completa, por segmentos de 7,8 s com 25 % de sobreposição e soma normalizada.
3. Motores especialistas só recebem a pista-mãe para a qual estão configurados (ex.: DrumSep recebe só a bateria).
4. Para não duplicar nem perder energia, a pista-mãe passa a "grupo de referência" e ganha uma pista "resíduo" = mãe - soma das filhas. A mistura reconstruída soma apenas as folhas.
5. Resultados guardados em IndexedDB (chave: SHA-256 do ficheiro + motor + URL) e modelos na Cache API.

A mistura reconstruída é a soma das pistas do modelo, não uma cópia do original; o ficheiro LEIA-ME.txt exportado indica a relação sinal/erro medida.

## Executar

```
python3 -m http.server 8000     # ou qualquer servidor estático
# abrir http://localhost:8000/
```

O ORT Web é carregado do jsDelivr (versão 1.22.0). Para alojar localmente, copie `dist/` do pacote `onnxruntime-web@1.22.0` para `vendor/` e defina antes do `main.js`:
`<script>globalThis.BANDA_ORT_BASE = '/ferramentas/stem-separator/vendor/'</script>`.

Servir com os cabeçalhos `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp` ativa WebAssembly com várias threads (opcional).

## Integrar na secção FERRAMENTAS

Não tive acesso ao código do seu site, por isso não alterei nada nele. A pasta é autónoma: copie-a para `/ferramentas/stem-separator/` e ligue a partir do menu, ou incorpore com `<iframe src="/ferramentas/stem-separator/" allow="autoplay">`. Não toca em autenticação, base de dados nem pagamentos.

Requisitos: navegador com WebGPU (Chrome/Edge 113+, Safari 18+) para velocidade razoável; sem WebGPU corre em WebAssembly, bastante mais lento. O modelo fp16 ocupa ~166 MB e a memória do separador pode ultrapassar 1 GB em músicas longas.

## Licenças

Ver `THIRD_PARTY.md`.
