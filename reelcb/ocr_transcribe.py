#!/usr/bin/env python3
"""Extrai transcrição com tempos reais a partir da legenda automática QUEIMADA no vídeo
(a versão de baixa resolução, nunca a 4K crua). Fecha o passo 3 do processo
(claude/producao-reels/processo-ponta-a-ponta.md) que antes era "manual/agente" sem
ferramenta própria.

Como funciona: amostra frames a um fps fixo, recorta a faixa onde a legenda normalmente
fica (ajustável), roda OCR (tesseract, idioma por) só nessa faixa, e registra o tempo real
(em segundos) toda vez que o texto da legenda muda — isso dá blocos com tempo real de
início, igual ao formato que a skill `decupador-reels-cb` espera.

Uso:
    python -m reelcb.ocr_transcribe video_legendado.mp4 --out transcricao.txt
    python -m reelcb.ocr_transcribe video_legendado.mp4 --preview   # salva recortes de amostra
                                                                     # pra calibrar a faixa

Calibração da faixa: os apps de legenda automática (Instagram/CapCut) normalmente centralizam
o texto no terço inferior-médio da tela. Se o OCR sair vazio ou errado, rode --preview,
olhe as imagens em ocr_preview/ e ajuste --y0/--y1 (frações de 0 a 1 da altura).
"""
import argparse, os, re, sys
import cv2
import numpy as np
import pytesseract

def normalize(t: str) -> str:
    t = re.sub(r"[^\wÀ-ÿ\s]", "", t, flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t

def similar(a: str, b: str) -> bool:
    """Compara textos de OCR consecutivos tolerando ruído pequeno (não exige igualdade perfeita
    porque o OCR pode variar 1-2 caracteres entre frames vizinhos do mesmo texto)."""
    if not a or not b:
        return a == b
    la, lb = len(a), len(b)
    if abs(la - lb) > max(3, 0.25 * max(la, lb)):
        return False
    short, long_ = (a, b) if la <= lb else (b, a)
    hits = sum(1 for c in short if c in long_)
    return hits / max(1, len(short)) > 0.7

def extract(video_path, y0=0.55, y1=0.82, sample_fps=8.0, lang="por", min_dur=0.12):
    cap = cv2.VideoCapture(video_path)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, int(round(src_fps / sample_fps)))

    blocks = []  # (start_s, text)
    last_norm = None
    last_start = None
    cfg = "--psm 6"

    idx = 0
    while idx < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        t = idx / src_fps
        crop = frame[int(h * y0):int(h * y1), :]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
        _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        text = pytesseract.image_to_string(bw, lang=lang, config=cfg)
        norm = normalize(text)

        if norm and (last_norm is None or not similar(norm, last_norm)):
            if last_norm and last_start is not None and (t - last_start) >= min_dur:
                blocks.append((round(last_start, 2), last_norm))
            last_norm = norm
            last_start = t
        elif not norm and last_norm:
            if (t - last_start) >= min_dur:
                blocks.append((round(last_start, 2), last_norm))
            last_norm = None
            last_start = None
        idx += step

    if last_norm and last_start is not None:
        blocks.append((round(last_start, 2), last_norm))

    # funde blocos muito próximos e curtos (ruído de OCR piscando)
    merged = []
    for t, txt in blocks:
        if merged and (t - merged[-1][0]) < min_dur:
            continue
        merged.append((t, txt))
    cap.release()
    return merged, {"src_fps": src_fps, "total_frames": total_frames, "w": w, "h": h}

def save_preview(video_path, y0, y1, out_dir="ocr_preview", n=6):
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    idxs = np.linspace(0, max(0, total - 1), n, dtype=int)
    for i, fidx in enumerate(idxs):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fidx))
        ok, frame = cap.read()
        if not ok:
            continue
        crop = frame[int(h * y0):int(h * y1), :]
        cv2.imwrite(os.path.join(out_dir, f"sample_{i:02d}.png"), crop)
    cap.release()
    print(f"amostras salvas em {out_dir}/ — confira se a legenda aparece inteira no recorte")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", default=None, help="arquivo .txt de saída (padrão: <video>.transcricao.txt)")
    ap.add_argument("--y0", type=float, default=0.55, help="início da faixa de legenda (fração da altura)")
    ap.add_argument("--y1", type=float, default=0.82, help="fim da faixa de legenda (fração da altura)")
    ap.add_argument("--fps", type=float, default=8.0, help="frames amostrados por segundo")
    ap.add_argument("--lang", default="por")
    ap.add_argument("--preview", action="store_true", help="só salva recortes de amostra pra calibrar y0/y1")
    a = ap.parse_args()

    if a.preview:
        save_preview(a.video, a.y0, a.y1)
        return

    blocks, meta = extract(a.video, y0=a.y0, y1=a.y1, sample_fps=a.fps, lang=a.lang)
    out_path = a.out or (os.path.splitext(a.video)[0] + ".transcricao.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        for t, txt in blocks:
            f.write(f'{t:.2f}  "{txt}"\n')
    print(f"{len(blocks)} blocos -> {out_path}")
    print("fonte:", meta)
    print("\nREVISE o arquivo antes de passar pra skill decupador-reels-cb — OCR erra "
          "nomes próprios e números às vezes. Corrija o texto, nunca os tempos (os tempos "
          "são reais, ancorados no frame).")

if __name__ == "__main__":
    main()
