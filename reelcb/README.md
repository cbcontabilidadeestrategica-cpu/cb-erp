# reelcb — pipeline editorial de Reels CB (data-driven)

Transforma uma gravação falando para a câmera num Reel 9:16 no padrão editorial da CB
(creme/navy/serifa azul-aço, sem logo, zoom suave, sem música, legendas minúsculas),
**por código**. O que muda a cada vídeo é **só um `spec.json`** — nunca mais Python escrito à mão.

Movido pra este repositório em 25/11/2026 pra resolver a persistência entre sessões: antes,
o código só sobrevivia via zip reanexado manualmente ou reconstrução a partir de um doc —
agora basta clonar este repo.

## O que é estável vs. o que muda

| Estável (nunca reescreve) | Muda por vídeo |
|---|---|
| `brand.py` — paleta, fontes, ícones | `spec.json` — segmentos + cartões + legendas |
| `templates.py` — 6 templates de cartão | o 4K cru + a versão legendada (entradas) |
| `captions.py` — legendas | |
| `compose.py` — render | |
| `audio.py` — voz/SFX/swish/riser | |
| `build.py` — orquestrador | |
| `reference.py` — números medidos (zoom, dwell, SFX) | |
| `sync.py` — imanta cortes na pausa de voz real | |
| `ocr_transcribe.py` — extrai transcrição com tempo real da versão legendada | |
| `qa_check.py` — triagem de qualidade antes de publicar | |

## Processo completo (ponta a ponta)

Ver `claude/producao-reels/processo-ponta-a-ponta.md` no projeto MARKETING (claude.ai) pro
mapa completo do roteiro cena a cena até o vídeo publicado. Resumo:

1. **Roteiro cena a cena** (no calendário CB Hub) — guia de gravação.
2. **Gravação em dois arquivos** — 4K cru (vira o final) + versão com legenda automática
   queimada (serve só pra OCR).
3. **OCR com tempo real**:
   ```bash
   python -m reelcb.ocr_transcribe video_legendado.mp4 --preview   # calibra a faixa
   python -m reelcb.ocr_transcribe video_legendado.mp4 --out transcricao.txt
   ```
   Revisar o `.txt` (corrigir texto, nunca os tempos) antes do próximo passo.
4. **Decupagem** — skill `decupador-reels-cb` lê a transcrição revisada e decide cortes,
   templates e legendas, gerando o `spec.json`.
5. **Sincronia de corte**:
   ```bash
   python -m reelcb.sync out/voice_raw.wav 2.80 7.20 13.40 ...
   ```
6. **Render**:
   ```bash
   python -m reelcb.build camera_4k.mp4 spec.json out/
   # -> out/final.mp4 + out/master.wav + out/stems/ + out/audio_report.json
   ```
7. **QA antes de publicar**:
   ```bash
   python -m reelcb.qa_check out/ spec.json --sync-report sync_report.json
   ```

Testes rápidos sem render completo:
```bash
python -m reelcb.templates                       # galeria dos 6 templates -> gallery/
python -m reelcb.compose contact spec.json        # grade de quadros -> contact.png
```

## Formato do `spec.json`

```jsonc
{
  "meta": { "fps":60, "source_fps":30, "content_frames":1448, "cam_src":"out/cam1404.mp4" },
  "segments": [
    { "mode":"CAM",  "s":0.0 },
    { "mode":"CARD", "s":2.8, "card": { "type":"checklist", ... } }
  ],
  "captions": [
    { "s":0.0, "main":"imagina só," },
    { "s":8.9, "emph":"planejamento" }
  ]
}
```

## Os 6 templates de cartão

| type | para quê | campos principais |
|---|---|---|
| `hero` | palavra/número-herói + contexto | `hero`, `lines[]`, `strike?`, `kicker?`, `footer?` |
| `checklist` | lista com checks surgindo | `items[]`, `title?`/`kicker?`, `icon?`, `footer?` |
| `compare` | duas colunas (ex: OUT vs NOV) | `left{title,ok,items[{text,ok}]}`, `right{...}`, `footer?` |
| `calendar` | grade de meses com destaque | `highlight`, `hero?`, `kicker?`, `done?[]`, `footer?` |
| `timeline` | de → para com seta | `from`, `to`, `title?`, `note?`, `hot?` |
| `dm` | mockup de DM digitando a isca | `msg`, `reply?`, `hero?`, `kicker?`, `header?` |

Mais um modo que não é template de cartão: `"mode":"BROLL"` com `broll:{image, kicker?, caption?}`
pra mostrar um print/foto real na tela.

## Ambiente

```bash
pip install --break-system-packages opencv-contrib-python-headless==4.10.0.84 scipy pillow numpy pytesseract
# + ffmpeg no PATH
# + tesseract-ocr no PATH, com pacote de idioma "por"
```

Fontes (`Inter.ttf`, `PlayfairItalic.ttf`) já vêm empacotadas em `fonts/`.
