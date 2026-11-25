#!/usr/bin/env python3
"""Áudio data-driven: voz + SFX + swishes + riser, SEM música.
Os tempos de SFX/swish/riser são DERIVADOS do spec (entrada de cartão = início do segmento CARD;
swish em todo corte; riser termina na 1ª junção câmera→cartão) — nada de tempo à mão.

build_audio(spec, voice_raw, out_dir) -> dict relatório
"""
import os, re, json, subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR=48000
rng=np.random.default_rng(7)

def lp(x,fc,order=4): return sosfilt(butter(order,fc/(SR/2),btype="low",output="sos"),x)
def hp(x,fc,order=2): return sosfilt(butter(order,fc/(SR/2),btype="high",output="sos"),x)
def bp(x,f1,f2,order=4): return sosfilt(butter(order,[f1/(SR/2),f2/(SR/2)],btype="band",output="sos"),x)

def env_adsr(n,a,d,s,r,sus=None):
    sus=s if sus is None else sus; a=int(a*SR);d=int(d*SR);r=int(r*SR); out=np.ones(n)
    if a>0: out[:a]=np.linspace(0,1,a)
    if d>0: out[a:a+d]=np.linspace(1,sus,d)
    out[a+d:n-r]=sus
    if r>0: out[n-r:]=np.linspace(out[max(a+d,n-r-1)] if n-r>0 else sus,0,r)
    return out

def sfx_impact(dur=0.26):
    n=int(dur*SR); t=np.arange(n)/SR
    thump=np.sin(2*np.pi*(90*np.exp(-t*20)+50)*t)*np.exp(-t*12)
    body=lp(rng.standard_normal(n),900)*np.exp(-t*18)
    x=thump*0.9+body*0.4; return x/np.max(np.abs(x)+1e-9)
def sfx_click(dur=0.045):
    n=int(dur*SR); t=np.arange(n)/SR
    x=bp(rng.standard_normal(n),1500,4000)*np.exp(-t*120)+np.sin(2*np.pi*2200*t)*np.exp(-t*160)*0.5
    return x/np.max(np.abs(x)+1e-9)
def sfx_key(dur=0.035):
    n=int(dur*SR); t=np.arange(n)/SR
    x=bp(rng.standard_normal(n),2500,6000)*np.exp(-t*160); return x/np.max(np.abs(x)+1e-9)
def sfx_confirm():
    parts=[]
    for f,d in [(880,0.09),(1318,0.16)]:
        n=int(d*SR);t=np.arange(n)/SR; parts.append(np.sin(2*np.pi*f*t)*env_adsr(n,0.004,0.03,0.5,0.05))
    x=np.concatenate(parts); return x/np.max(np.abs(x)+1e-9)
def sfx_whoosh(dur=0.40):
    n=int(dur*SR); t=np.arange(n)/SR
    sw=bp(rng.standard_normal(n),300,3000); amp=np.exp(-((t-dur/2)/(dur/5))**2)
    x=sw*amp; return x/np.max(np.abs(x)+1e-9)

def place(track,sig,t,gain):
    i=int(t*SR); s=min(len(sig),len(track)-i)
    if i<0 or s<=0: return
    track[i:i+s]+=sig[:s]*gain

def measure(path):
    r=subprocess.run(["ffmpeg","-i",path,"-af","ebur128=peak=true","-f","null","-"],
                     capture_output=True,text=True); out=r.stderr; I=TP=None
    for m in re.finditer(r"I:\s*(-?\d+\.?\d*)\s*LUFS",out): I=float(m.group(1))
    for m in re.finditer(r"Peak:\s*(-?\d+\.?\d*)\s*dBFS",out): TP=float(m.group(1))
    return I,TP

def write_wav(path,x): wavfile.write(path,SR,(np.clip(x,-1,1)*32767).astype(np.int16))
def to_stereo(x): return np.stack([x,x],1) if x.ndim==1 else x

def loudnorm(inp,outp,I=-14.0,TP=-1.0,LRA=11.0):
    r=subprocess.run(["ffmpeg","-i",inp,"-af",f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json","-f","null","-"],
                     capture_output=True,text=True)
    txt=r.stderr; s=txt.rfind("{"); e=txt.rfind("}")
    meas=json.loads(txt[s:e+1]) if s>=0 else {}
    af=(f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={meas.get('input_i',I)}:"
        f"measured_TP={meas.get('input_tp',TP)}:measured_LRA={meas.get('input_lra',LRA)}:"
        f"measured_thresh={meas.get('input_thresh',-24)}:linear=true:print_format=summary")
    subprocess.run(["ffmpeg","-y","-v","error","-i",inp,"-af",af,"-ar","48000","-ac","2",outp],
                   capture_output=True,text=True)

def _spec_timings(spec):
    """Deriva do spec: entradas de cartão, limites de corte, 1ª junção, tipo de cartão."""
    fps_src=spec["meta"].get("source_fps",30)
    content=spec["meta"]["content_frames"]/fps_src
    segs=spec["segments"]
    bounds=[s["s"] for s in segs[1:]]                       # todo corte (menos t=0)
    cards=[]
    for i,s in enumerate(segs):
        if s["mode"]!="CAM":
            e=segs[i+1]["s"] if i+1<len(segs) else content
            cards.append({"s":s["s"],"e":e,"type":s["card"]["type"],"card":s["card"]})
    first_card=cards[0]["s"] if cards else min(content,3.0)
    return content, bounds, cards, first_card

def build_audio(spec, voice_raw, out_dir):
    """spec: dict já carregado. voice_raw: wav da voz crua (4K). out_dir: pasta de saída."""
    stems=os.path.join(out_dir,"stems"); os.makedirs(stems,exist_ok=True)
    content, bounds, cards, first_card = _spec_timings(spec)
    N=int(round(content*SR)); report={}

    # ---- voz ----
    sr,vraw=wavfile.read(voice_raw); vraw=vraw.astype(np.float32)/32768.0
    if vraw.ndim==1: vraw=np.stack([vraw,vraw],1)
    clen=int(round(content*SR))
    vraw=vraw[:clen] if len(vraw)>=clen else np.pad(vraw,((0,clen-len(vraw)),(0,0)))
    vraw=hp(vraw.T,70).T
    v=np.zeros((N,2),np.float32); v[:clen]=vraw
    write_wav(os.path.join(stems,"_voice_pre.wav"),v)
    loudnorm(os.path.join(stems,"_voice_pre.wav"),os.path.join(stems,"voice.wav"),I=-14.0,TP=-1.0,LRA=7.0)
    vI,vTP=measure(os.path.join(stems,"voice.wav")); report["voice"]={"I":vI,"TP":vTP}
    vpeak=10**((vTP or -1.0)/20)

    # ---- música: NENHUMA (stem silencioso p/ consistência) ----
    write_wav(os.path.join(stems,"music.wav"),to_stereo(np.zeros(N)))
    report["music"]={"I":"-inf (sem música)","TP":"-inf"}

    # ---- sfx (DERIVADO do spec) ----
    sfx=np.zeros(N); g_imp=vpeak*10**(-10/20); g_key=vpeak*10**(-16/20); g_sw=vpeak*10**(-12/20)
    events=[]
    for c in cards:
        place(sfx,sfx_impact(),c["s"],g_imp*0.9); events.append((round(c["s"],2),f"impacto (cartão {c['type']})"))
        # checklist: confirmações nos itens
        if c["type"]=="checklist":
            items=c["card"].get("items",[])
            for i in range(len(items)):
                place(sfx,sfx_confirm(),c["s"]+0.4+i*0.5,g_key*1.4)
            if items: events.append((round(c["s"]+0.4,2),f"confirmações ({len(items)} itens)"))
        # hero com strike + checklist embutido? só impacto. dm: teclas + clique
        if c["type"]=="dm":
            tk=c["s"]+0.2
            for i in range(7): place(sfx,sfx_key(),tk+i*0.16,g_key)
            events.append((round(tk,2),"teclas (digitação DM)"))
            place(sfx,sfx_click(),tk+7*0.16+0.2,g_imp); events.append((round(tk+7*0.16+0.2,2),"clique enviar"))
    # swishes em todo corte câmera↔cartão
    wh=sfx_whoosh(0.40)
    for cb in bounds: place(sfx,wh,cb-0.20,g_sw)
    events.append(("vários","swishes de transição nos cortes"))
    write_wav(os.path.join(stems,"sfx.wav"),to_stereo(sfx))
    sI,sTP=measure(os.path.join(stems,"sfx.wav")); report["sfx"]={"I":sI,"TP":sTP}; report["sfx_events"]=events

    # ---- riser: termina na 1ª junção câmera→cartão ----
    riser=np.zeros(N); rend=first_card; rdur=min(2.6,max(0.8,first_card-0.1))
    ri=int(max(0,(rend-rdur))*SR); rn=int(rdur*SR); t=np.arange(rn)/SR
    base=50+(120-50)*(t/rdur)**2
    tone=np.sin(2*np.pi*np.cumsum(base)/SR); nz=lp(rng.standard_normal(rn),2000)*0.3
    r=(tone*0.7+nz)*((t/rdur)**2.2)
    if rn>int(0.02*SR): r[-int(0.02*SR):]*=np.linspace(1,0,int(0.02*SR))
    g_ri=vpeak*10**(-14/20)/(np.max(np.abs(r))+1e-9); riser[ri:ri+rn]+=r*g_ri
    write_wav(os.path.join(stems,"riser.wav"),to_stereo(riser))
    rI,rTP=measure(os.path.join(stems,"riser.wav")); report["riser"]={"I":rI,"TP":rTP}

    # ---- master = soma dos stems entregues, normalizado p/ -14 LUFS / -1 dBTP ----
    def rd(p):
        _,a=wavfile.read(p); a=a.astype(np.float32)/32768.0
        if a.ndim==1: a=np.stack([a,a],1)
        return a[:N] if len(a)>=N else np.pad(a,((0,N-len(a)),(0,0)))
    master=(rd(os.path.join(stems,"voice.wav"))+rd(os.path.join(stems,"music.wav"))
            +rd(os.path.join(stems,"sfx.wav"))+rd(os.path.join(stems,"riser.wav")))
    write_wav(os.path.join(stems,"_master_pre.wav"),master)
    report["master_presum"]=dict(zip(("I","TP"),measure(os.path.join(stems,"_master_pre.wav"))))
    loudnorm(os.path.join(stems,"_master_pre.wav"),os.path.join(out_dir,"master.wav"),I=-14.0,TP=-1.0,LRA=11.0)
    MI,MTP=measure(os.path.join(out_dir,"master.wav")); report["master"]={"I":MI,"TP":MTP}
    for f in ("_voice_pre","_master_pre"):
        p=os.path.join(stems,f+".wav")
        if os.path.exists(p): os.remove(p)
    json.dump(report,open(os.path.join(out_dir,"audio_report.json"),"w"),ensure_ascii=False,indent=1)
    return report
