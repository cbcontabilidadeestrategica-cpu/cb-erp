#!/usr/bin/env python3
"""Imanta cortes propostos na pausa de voz real mais próxima (em vez de cair no
meio de uma palavra/gesto, como às vezes acontece com o tempo exato do OCR).

Usa a envoltória de energia da própria faixa de voz (já extraída do 4K) pra achar
o vale de silêncio mais próximo de cada tempo de corte proposto, dentro de uma
janela de busca pequena — nunca desloca o corte pra longe do que foi dito.
"""
import numpy as np
from scipy.io import wavfile
from . import reference as REF

def _envelope(x, sr, win_ms=12):
    """Envoltória RMS suavizada da faixa de voz (mono)."""
    if x.ndim>1: x=x.mean(axis=1)
    x=x.astype(np.float32)
    win=max(1,int(sr*win_ms/1000))
    sq=x*x
    kernel=np.ones(win)/win
    rms=np.sqrt(np.convolve(sq,kernel,mode="same")+1e-12)
    return rms

def find_pauses(voice_wav_path, min_silence_s=None):
    """Retorna lista de (centro_s, duracao_s) de trechos de baixa energia (pausas de voz)."""
    min_silence_s = min_silence_s or REF.CUT_SNAP_MIN_SILENCE_S
    sr, x = wavfile.read(voice_wav_path)
    x = x.astype(np.float32)/32768.0 if x.dtype.kind=="i" else x.astype(np.float32)
    env = _envelope(x, sr)
    thresh = np.percentile(env, 15) * 2.2   # piso adaptativo: ~15º percentil da energia
    below = env < thresh
    pauses=[]
    i=0; n=len(below)
    while i<n:
        if below[i]:
            j=i
            while j<n and below[j]: j+=1
            dur=(j-i)/sr
            if dur>=min_silence_s:
                pauses.append(((i+j)/2/sr, dur))
            i=j
        else:
            i+=1
    return pauses

def snap_cuts_to_pauses(cut_times, voice_wav_path, search_s=None):
    """Para cada tempo de corte proposto, desloca pro centro da pausa de voz mais
    próxima DENTRO da janela de busca. Se nenhuma pausa estiver na janela, mantém
    o tempo original (não força um corte pra onde não há silêncio)."""
    search_s = search_s or REF.CUT_SNAP_SEARCH_S
    pauses = find_pauses(voice_wav_path)
    if not pauses: return list(cut_times), []
    centers = np.array([p[0] for p in pauses])
    snapped=[]; report=[]
    for t in cut_times:
        d = np.abs(centers - t)
        k = int(np.argmin(d))
        if d[k] <= search_s:
            snapped.append(round(float(centers[k]),3))
            report.append({"original":t,"ajustado":round(float(centers[k]),3),
                           "deslocamento_ms":round(float(centers[k]-t)*1000,1)})
        else:
            snapped.append(t)
            report.append({"original":t,"ajustado":t,"deslocamento_ms":0.0,"obs":"sem pausa na janela de busca"})
    return snapped, report

if __name__=="__main__":
    import sys, json
    voice=sys.argv[1]; times=[float(x) for x in sys.argv[2:]]
    snapped, rep = snap_cuts_to_pauses(times, voice)
    print(json.dumps(rep, ensure_ascii=False, indent=1))
