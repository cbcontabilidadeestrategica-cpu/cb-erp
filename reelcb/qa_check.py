#!/usr/bin/env python3
"""Revisor/QA independente do final.mp4 — item que o roteiro de melhorias marcava como
"ainda não construído, candidato pra depois do item 4" (ver producao-reels/roteiro-de-melhorias.md).
Não decide nada de criativo; só confere números contra o padrão (reference.py) e aponta o
que merece revisão humana antes de publicar.

Uso:
    python -m reelcb.qa_check out/ spec.json [--sync-report sync_report.json]

Confere:
  1. Loudness do master (audio_report.json) contra o alvo (-14 LUFS / -1 dBTP)
  2. Cortes com deslocamento de sincronia grande ou sem pausa encontrada (se um
     sync_report.json foi salvo pelo passo de imantação)
  3. Cartões com campos vazios/placeholder esquecidos (ex. "..." , "EXEMPLO", "TODO")
  4. Legendas (captions) repetidas ou vazias
  5. Duração de cada cartão dentro da janela aprovada (CARD_DWELL_MIN_S/MAX_S)
  6. Dois cartões (CARD/BROLL) seguidos sem CAM no meio — contra a regra do Decupador

Não substitui olhar o vídeo — é uma triagem rápida antes de assistir o final.mp4 inteiro.
"""
import argparse, json, os, re, sys
from . import reference as REF

PLACEHOLDER_RE = re.compile(r"\b(TODO|EXEMPLO|XXX|\.\.\.|lorem)\b", re.IGNORECASE)

def check_loudness(out_dir):
    path = os.path.join(out_dir, "audio_report.json")
    if not os.path.exists(path):
        return [("loudness", "FALTA", "audio_report.json não encontrado — rodou o build?")]
    rep = json.load(open(path))
    flags = []
    m = rep.get("master", {})
    I, TP = m.get("I"), m.get("TP")
    if I is None or TP is None:
        flags.append(("loudness", "FALTA", "master.wav sem medição (I/TP ausentes)"))
        return flags
    if abs(I - REF.VOICE_TARGET_LUFS) > 1.0:
        flags.append(("loudness", "REVISAR", f"master em {I} LUFS (alvo {REF.VOICE_TARGET_LUFS} ±1)"))
    else:
        flags.append(("loudness", "OK", f"master em {I} LUFS"))
    if TP > REF.VOICE_TARGET_TP + 0.3:
        flags.append(("loudness", "REVISAR", f"true peak em {TP} dBTP (alvo <= {REF.VOICE_TARGET_TP})"))
    else:
        flags.append(("loudness", "OK", f"true peak em {TP} dBTP"))
    return flags

def check_sync(sync_report_path):
    if not sync_report_path or not os.path.exists(sync_report_path):
        return [("sincronia", "PULADO", "nenhum sync_report.json informado")]
    rep = json.load(open(sync_report_path))
    flags = []
    for item in rep:
        desl = abs(item.get("deslocamento_ms", 0))
        if item.get("obs") == "sem pausa na janela de busca":
            flags.append(("sincronia", "REVISAR", f"corte em {item['original']}s sem pausa de voz perto — conferir no vídeo"))
        elif desl > 150:
            flags.append(("sincronia", "REVISAR", f"corte em {item['original']}s deslocado {desl}ms — maior que o normal"))
    if not flags:
        flags.append(("sincronia", "OK", f"{len(rep)} cortes, todos dentro do esperado"))
    return flags

def check_cards(spec):
    flags = []
    segs = spec["segments"]
    content = spec["meta"]["content_frames"] / spec["meta"].get("source_fps", 30)
    prev_mode = None
    for i, s in enumerate(segs):
        e = segs[i + 1]["s"] if i + 1 < len(segs) else content
        dur = e - s["s"]
        mode = s["mode"]
        if mode in ("CARD", "BROLL"):
            if prev_mode in ("CARD", "BROLL"):
                flags.append(("cartões", "REVISAR", f"dois cartões seguidos sem CAM no meio (em {s['s']}s) — contra a regra do Decupador"))
            if mode == "CARD":
                if dur < REF.CARD_DWELL_MIN_S - 0.05:
                    flags.append(("cartões", "REVISAR", f"cartão em {s['s']}s dura {dur:.1f}s — abaixo do mínimo ({REF.CARD_DWELL_MIN_S}s)"))
                if dur > REF.CARD_DWELL_MAX_S + 0.05:
                    flags.append(("cartões", "REVISAR", f"cartão em {s['s']}s dura {dur:.1f}s — acima do máximo ({REF.CARD_DWELL_MAX_S}s)"))
                card_text = json.dumps(s["card"], ensure_ascii=False)
                if PLACEHOLDER_RE.search(card_text):
                    flags.append(("cartões", "REVISAR", f"cartão em {s['s']}s tem texto placeholder (TODO/EXEMPLO/...)"))
                for k, v in s["card"].items():
                    if isinstance(v, str) and not v.strip():
                        flags.append(("cartões", "REVISAR", f"cartão em {s['s']}s tem campo '{k}' vazio"))
        prev_mode = mode
    if segs and segs[-1]["mode"] not in ("CARD",) or (segs and segs[-1].get("card", {}).get("type") != "dm"):
        flags.append(("cartões", "REVISAR", "último segmento não é um cartão 'dm' (CTA) — confirma se é proposital"))
    if not any(f[1] == "REVISAR" for f in flags):
        flags.append(("cartões", "OK", f"{len(segs)} segmentos, nenhum problema estrutural encontrado"))
    return flags

def check_captions(spec):
    flags = []
    caps = spec.get("captions", [])
    seen = set()
    for c in caps:
        txt = (c.get("main") or "") + " " + (c.get("emph") or "")
        txt = txt.strip()
        if not txt:
            flags.append(("legendas", "REVISAR", f"legenda vazia em {c['s']}s"))
            continue
        key = txt.lower()
        if key in seen:
            flags.append(("legendas", "REVISAR", f"legenda repetida em {c['s']}s: \"{txt}\""))
        seen.add(key)
        if txt.isupper() and len(txt) > 3:
            flags.append(("legendas", "REVISAR", f"legenda toda maiúscula em {c['s']}s (padrão é minúscula): \"{txt}\""))
    if not any(f[1] == "REVISAR" for f in flags):
        flags.append(("legendas", "OK", f"{len(caps)} blocos de legenda, sem repetição/vazio"))
    return flags

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("spec")
    ap.add_argument("--sync-report", default=None)
    a = ap.parse_args()

    spec = json.load(open(a.spec))
    all_flags = []
    all_flags += check_loudness(a.out_dir)
    all_flags += check_sync(a.sync_report)
    all_flags += check_cards(spec)
    all_flags += check_captions(spec)

    n_revisar = sum(1 for f in all_flags if f[1] == "REVISAR")
    print(f"=== QA — {len(all_flags)} checagens, {n_revisar} pra revisar ===\n")
    for area, status, msg in all_flags:
        print(f"[{status:8s}] ({area}) {msg}")

    report_path = os.path.join(a.out_dir, "qa_report.json")
    json.dump(
        [{"area": a_, "status": s_, "msg": m_} for a_, s_, m_ in all_flags],
        open(report_path, "w"), ensure_ascii=False, indent=1,
    )
    print(f"\nrelatório salvo em {report_path}")
    if n_revisar:
        print(f"\n{n_revisar} ponto(s) pra olhar antes de publicar — não bloqueia, é checklist.")
    sys.exit(0)

if __name__ == "__main__":
    main()
