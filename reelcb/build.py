#!/usr/bin/env python3
"""Orquestrador: dado o 4K cru + um spec.json, produz final.mp4 + stems + relatório.

Uso:
  python -m reelcb.build <cam_4k.mp4> <spec.json> <out_dir> [--voice <wav>]

Passos:
 1. extrai a fonte de zoom 1404×2496 do 4K (se meta.cam_src não existir)
 2. extrai a voz do 4K (se --voice não for dado)
 3. renderiza o vídeo mudo (compose) e o áudio (audio, SFX derivado do spec)
 4. muxa com -0.3 dB (garante TP<=-1 no AAC) -> final.mp4
"""
import sys, os, json, argparse, subprocess
from .compose import Reel
from .audio import build_audio

def _run(cmd): subprocess.run(cmd,check=True)

def ensure_cam1404(cam4k, cam_src):
    if os.path.exists(cam_src): return
    _run(["ffmpeg","-y","-v","error","-i",cam4k,"-vf","scale=1404:2496","-r","30","-an",
          "-c:v","libx264","-preset","veryfast","-crf","16",cam_src])

def ensure_voice(cam4k, voice_wav):
    if os.path.exists(voice_wav): return
    _run(["ffmpeg","-y","-v","error","-i",cam4k,"-vn","-ac","2","-ar","48000",
          "-c:a","pcm_s16le",voice_wav])

def build(cam4k, spec_path, out_dir, voice=None, skip_render=False):
    os.makedirs(out_dir,exist_ok=True)
    spec=json.load(open(spec_path))
    cam_src=spec["meta"]["cam_src"]
    ensure_cam1404(cam4k, cam_src)
    voice=voice or os.path.join(out_dir,"voice_raw.wav")
    ensure_voice(cam4k, voice)
    mute=os.path.join(out_dir,"video_mute.mp4")
    if not skip_render:
        print("render vídeo..."); Reel(spec_path).render(mute)
    print("build áudio..."); rep=build_audio(spec, voice, out_dir)
    final=os.path.join(out_dir,"final.mp4")
    _run(["ffmpeg","-y","-v","error","-i",mute,"-i",os.path.join(out_dir,"master.wav"),
          "-c:v","copy","-af","volume=-0.3dB","-c:a","aac","-b:a","256k","-ar","48000",
          "-movflags","+faststart",final])
    print("OK ->",final)
    print("master LUFS",rep["master"]["I"],"TP",rep["master"]["TP"])
    return final, rep

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("cam4k"); ap.add_argument("spec"); ap.add_argument("out_dir")
    ap.add_argument("--voice",default=None); ap.add_argument("--skip-render",action="store_true")
    a=ap.parse_args()
    build(a.cam4k,a.spec,a.out_dir,voice=a.voice,skip_render=a.skip_render)
