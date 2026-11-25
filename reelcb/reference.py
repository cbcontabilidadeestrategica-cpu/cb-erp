#!/usr/bin/env python3
"""Biblioteca de referência MEDIDA — números do padrão editorial aprovado, como dados.
Em vez de "eu lembro que o zoom era mais ou menos assim", os parâmetros vivem aqui e
compose.py/templates.py/a skill do Decupador leem daqui. Atualize este arquivo (não a
memória) quando analisar um novo Reel de referência — ver measure_reference.py.

Fonte dos valores atuais: análise forense do Reel de referência da CB (0928) +
ajustes validados pelos feedbacks do usuário (sem música, sem logo, zoom suave)."""

# ---- câmera: zoom contínuo (smooth_zoom) ----
ZOOM_MIN = 1.00
ZOOM_MAX = 1.20
ZOOM_PERIOD_S = 3.8          # período do ciclo de respiração do zoom
ZOOM_PHASE = 0.6             # deslocamento de fase (rad)
PAN_X_AMP = 0.022            # deriva horizontal, fração da largura da fonte
PAN_X_PERIOD_S = 8.5
PAN_Y_AMP = 0.010
PAN_Y_PERIOD_S = 6.0
ZOOM_SOFT_START_S = 0.35     # arranque suave após corte pra câmera (evita salto)

# ---- cartão: entrada e permanência ----
CARD_ENTRANCE_S = 0.22        # duração do punch de entrada (1.06 -> 1.0)
CARD_ENTRANCE_PUNCH = 0.06    # amplitude do punch
CARD_DWELL_MIN_S = 1.5        # permanência mínima de um cartão (medido na referência)
CARD_DWELL_MAX_S = 6.5        # permanência máxima
CARD_FADE_IN_S = 0.45         # fade-in padrão de itens dentro de um cartão (checklist/compare)
CARD_FADE_STAGGER_S = 0.5     # intervalo entre itens sucessivos aparecendo

# ---- cadência de corte ----
CUT_MIN_GAP_S = 1.0           # menor intervalo aceitável entre dois cortes quaisquer
FIRST_CARD_WINDOW_S = (3.0, 8.0)  # janela típica em que o 1º cartão deveria entrar

# ---- áudio ----
VOICE_TARGET_LUFS = -14.0
VOICE_TARGET_TP = -1.0
SFX_IMPACT_DB = -10           # abaixo do pico da voz
SFX_KEY_DB = -16
SFX_SWISH_DB = -12
RISER_DB = -14
RISER_DUR_S = 2.6

# ---- sincronia de corte (ver sync.py) ----
CUT_SNAP_SEARCH_S = 0.35      # janela de busca pra "imantar" um corte na pausa de voz mais próxima
CUT_SNAP_MIN_SILENCE_S = 0.06 # duração mínima de silêncio pra contar como pausa válida

NOTES = """
Como atualizar: analise um novo Reel de referência aprovado (medindo tempos de corte,
duração de cartão, amplitude de zoom quadro a quadro) e ajuste os valores acima — nunca
edite compose.py/templates.py diretamente para mudar "o jeito que fica". Assim o padrão
visual fica centralizado e versionável num lugar só.
"""
