# Licenças e origem (verificação feita em 26/11/2026)

O que está marcado "por confirmar" não foi possível verificar e deve ser confirmado antes de uso comercial.

| Projeto | Papel | Código | Pesos do modelo | Observações |
|---|---|---|---|---|
| Demucs (facebookresearch/demucs; fork em adefossez/demucs) | Arquitetura HTDemucs | MIT | Cartão do export ONNX indica MIT | Repositório original arquivado em 1/1/2025. Atribuição: Rouard, Massa, Défossez (ICASSP 2023) |
| StemSplitio/htdemucs-onnx (Hugging Face) | Export ONNX usado como motor base | MIT (segundo o cartão) | MIT (segundo o cartão) | Ficheiros: `htdemucs.onnx` 316 MB, `htdemucs_fp16weights.onnx` 166 MB |
| htdemucs-6s-onnx (StemSplitio) | Opcional, 6 pistas | por confirmar | por confirmar | Nome do ficheiro e tensores por confirmar. O piano do modelo 6s é descrito pelos autores como fraco |
| DrumSep (inagoy/drumsep) | Base do especialista de bateria | MIT | MIT (cartões dos exports) | Hybrid Demucs; 4 pistas: bombo, caixa, pratos, toms. Os pesos originais são distribuídos pelo autor sem declaração de licença própria (segundo o cartão ggaps/sound-space-models) |
| b33zy/drumsep-v2-onnx (Hugging Face) | Export ONNX usado, 168 MB, janela 10 s, SHA-256 verificado em execução | MIT (segundo o cartão) | MIT (segundo o cartão) | Fine-tune v2 (gridshiftstudio). O cartão avisa: proveniência dos dados de treino NÃO verificada; verificar antes de uso comercial |
| Timbrica drum separator (Faridzar) | NÃO integrado | n/d | CC BY-NC-SA 4.0 | Kick/snare/toms; uso comercial só com licença do autor |
| LarsNet ONNX (jezza672/larsnet-onnx) | NÃO integrado | n/d | CC BY-NC 4.0 (pesos LarsNet) | Cinco peças incluindo hi-hat; uso não comercial |
| onnxruntime-web | Execução no navegador | MIT | n/a | Carregado do jsDelivr |
| LARS / LarsNet (EdoardoMor/LARS, polimi-ispl/larsnet) | NÃO integrado | por confirmar | CC BY-NC 4.0 | Pesos não comerciais; motor PyTorch/LibTorch (plugin VST3/AU). Só integrar com autorização dos autores |
| Stemmy (pgotta/Stemmy) | NÃO integrado (referência) | MIT | modelos de terceiros com licenças próprias | App Windows (PyTorch, CUDA) |
| Stem Splitter (hmcelik/stem-splitter) | NÃO integrado (referência) | MIT | licença própria de cada modelo | App Windows (PySide6) |
| Stem Studio (d-r-e/stem-studio), Stemyla, sdemux | NÃO analisados | n/d | n/d | Páginas não lidas (limite de pedidos). Nenhum código reutilizado |

Nenhum código dos repositórios acima foi copiado para este projeto: o motor e a interface foram escritos de raiz; só os modelos ONNX (descarregados em tempo de execução, pelo visitante) vêm de terceiros.
