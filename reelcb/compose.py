#!/usr/bin/env python3
"""Renderizador data-driven: lê um spec.json e monta o vídeo (sem áudio).
Câmera (zoom suave contínuo, fonte 1404 do 4K) ↔ cartões (biblioteca de templates), cortes secos.

spec.json:
{
  "meta": {"fps":60,"source_fps":30,"content_frames":1448,"cam_src":"cam1404.mp4"},
  "segments": [ {"mode":"CAM","s":0.0}, {"mode":"CARD","s":2.8,"card":{...}}, ... ],
  "captions": [ {"s":0.0,"main":"imagina só,","emph":null}, ... ]
}
"""
import sys, json, math, subprocess
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageOps
from .brand import W, H, cream_bg, NAVY, STEEL
from .templates import render_card
from .captions import draw_caption
from . import reference as REF

class Reel:
    def __init__(self, spec_path):
        spec=json.load(open(spec_path))
        m=spec["meta"]
        self.fps=m.get("fps",60); self.sfps=m.get("source_fps",30)
        self.content=m["content_frames"]/self.sfps
        self.cam_path=m["cam_src"]
        self.src_w=m.get("src_w",1404); self.src_h=m.get("src_h",2496)
        self.nframes=int(round(self.content*self.fps))
        self.segs=self._segtable(spec["segments"])
        self.caps=self._captable(spec.get("captions",[]))
        self._cap=cv2.VideoCapture(self.cam_path)
        self._cur={"idx":-1,"frame":None}
        self._maxidx=m["content_frames"]-1
        self._broll_cache={}

    def _segtable(self, segs):
        out=[]
        for i,s in enumerate(segs):
            e=segs[i+1]["s"] if i+1<len(segs) else self.content
            out.append({**s,"e":e,"dur":e-s["s"]})
        return out

    def _captable(self, caps):
        out=[]
        for i,c in enumerate(caps):
            e=caps[i+1]["s"] if i+1<len(caps) else self.content
            out.append({**c,"e":e})
        return out

    # ---- camera source (1404) com leitura sequencial ----
    def cam_src(self, idx):
        idx=min(self._maxidx,max(0,idx))
        if idx==self._cur["idx"]: return self._cur["frame"]
        if idx<self._cur["idx"]:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES,idx); self._cur["idx"]=idx-1
        while self._cur["idx"]<idx:
            ret,fr=self._cap.read()
            if not ret: break
            self._cur["idx"]+=1; self._cur["frame"]=fr
        return self._cur["frame"]

    def punch(self, bgr, z, dx, dy):
        z=min(1.30,max(1.0,z))
        cw=int(round(self.src_w/z)); ch=int(round(self.src_h/z))
        cx=self.src_w/2+dx*self.src_w; cy=self.src_h/2+dy*self.src_h
        x0=int(np.clip(cx-cw/2,0,self.src_w-cw)); y0=int(np.clip(cy-ch/2,0,self.src_h-ch))
        crop=bgr[y0:y0+ch,x0:x0+cw]
        interp=cv2.INTER_AREA if cw>W else cv2.INTER_LANCZOS4
        out=cv2.resize(crop,(W,H),interpolation=interp)
        return cv2.cvtColor(out,cv2.COLOR_BGR2RGB)

    def smooth_zoom(self, t, seg):
        tl=t-seg["s"]
        zc=(REF.ZOOM_MIN+REF.ZOOM_MAX)/2; za=(REF.ZOOM_MAX-REF.ZOOM_MIN)/2
        z=zc+za*math.sin(2*math.pi*t/REF.ZOOM_PERIOD_S+REF.ZOOM_PHASE)
        dx=REF.PAN_X_AMP*math.sin(2*math.pi*t/REF.PAN_X_PERIOD_S)
        dy=REF.PAN_Y_AMP*math.sin(2*math.pi*t/REF.PAN_Y_PERIOD_S)
        if tl<REF.ZOOM_SOFT_START_S:                     # arranque suave no corte
            k=tl/REF.ZOOM_SOFT_START_S; z=1.0*(1-k)+z*k
        return z,dx,dy

    def _broll_img(self, path):
        if path in self._broll_cache: return self._broll_cache[path]
        im=Image.open(path).convert("RGB")
        self._broll_cache[path]=im
        return im

    def render_broll(self, seg, tl, dur):
        """Cartão de prova visual: print/foto real sobre o fundo creme, com moldura fina
        e Ken Burns leve (zoom-in sutil). seg['broll'] = {image, caption?, kicker?}."""
        b=seg["broll"]; board=cream_bg().convert("RGBA")
        im=self._broll_img(b["image"])
        # Ken Burns: zoom lento de 1.0 -> 1.06 ao longo da permanência
        p=min(1.0, tl/max(dur,1e-3)); z=1.0+0.06*p
        # encaixa dentro de uma área com margem, preservando proporção (sem cortar o print)
        pad=90; top=int(H*0.22); boxw=W-2*pad; boxh=int(H*0.56)
        iw,ih=im.size; scale=min(boxw/iw, boxh/ih)*z
        nw,nh=int(iw*scale), int(ih*scale)
        imz=im.resize((nw,nh), Image.LANCZOS)
        cx,cy=W//2, top+boxh//2
        x0,y0=cx-nw//2, cy-nh//2
        d=ImageDraw.Draw(board)
        # moldura fina + sombra suave, como um print "colado" com cuidado editorial
        d.rectangle([x0-3,y0-3,x0+nw+3,y0+nh+3], outline=STEEL, width=3)
        board.paste(imz,(x0,y0))
        if b.get("kicker"):
            d=ImageDraw.Draw(board)
            from .brand import play, SERIF
            d.text((W//2,int(H*0.14)),b["kicker"],font=play(50,"Italic"),fill=SERIF,anchor="mm")
        if b.get("caption"):
            d=ImageDraw.Draw(board)
            from .brand import inter, NAVY as _N
            d.text((W//2,int(H*0.82)),b["caption"],font=inter(44,"Medium"),fill=_N,anchor="mm")
        return board

    def card_entrance(self, board, tl):
        e=REF.CARD_ENTRANCE_S; pk=REF.CARD_ENTRANCE_PUNCH
        if tl<e: p=tl/e; z=(1+pk)-pk*(p*p*(3-2*p))
        else: z=max(1-pk*0.2, 1.0-0.012*min(1,(tl-e)/1.2))
        if abs(z-1)<1e-4: return board
        nw,nh=int(W*z),int(H*z); im=board.resize((nw,nh),Image.LANCZOS)
        ox=(nw-W)//2; oy=(nh-H)//2
        return im.crop((ox,oy,ox+W,oy+H))

    def seg_at(self,t):
        for s in self.segs:
            if s["s"]<=t<s["e"]: return s
        return self.segs[-1]
    def cap_at(self,t):
        for b in self.caps:
            if b["s"]<=t<b["e"]: return b
        return None

    def frame(self, f):
        t=f/self.fps; seg=self.seg_at(t); tl=t-seg["s"]
        if seg["mode"]=="CAM":
            z,dx,dy=self.smooth_zoom(t,seg)
            base=Image.fromarray(self.punch(self.cam_src(int(t*self.sfps)),z,dx,dy)).convert("RGBA")
            b=self.cap_at(t)
            if b and (b.get("main") or b.get("emph")):
                draw_caption(base,b.get("main",""),b.get("emph"))
        elif seg["mode"]=="BROLL":
            base=self.card_entrance(self.render_broll(seg,tl,seg["dur"]),tl)
        else:
            base=self.card_entrance(render_card(seg["card"],tl,seg["dur"]),tl)
        return base

    def render(self, out_path, log=True):
        cmd=["ffmpeg","-y","-v","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}",
             "-r",str(self.fps),"-i","-","-c:v","libx264","-preset","medium","-crf","17",
             "-pix_fmt","yuv420p","-movflags","+faststart",out_path]
        p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
        for gf in range(self.nframes):
            p.stdin.write(self.frame(gf).convert("RGB").tobytes())
            if log and gf%300==0: print("frame",gf,"/",self.nframes,flush=True)
        p.stdin.close(); p.wait()
        if log: print("DONE",self.nframes,"->",out_path)

    def contact_sheet(self, out_path, times):
        tiles=[]
        for t in times:
            f=max(0,min(self.nframes-1,int(round(t*self.fps))))
            tiles.append(self.frame(f).convert("RGB").resize((200,356)))
        cols=min(7,len(tiles)); rows=(len(tiles)+cols-1)//cols
        s=Image.new("RGB",(200*cols,356*rows),(40,40,40))
        for i,im in enumerate(tiles): s.paste(im,((i%cols)*200,(i//cols)*356))
        s.save(out_path)

if __name__=="__main__":
    spec=sys.argv[2] if len(sys.argv)>2 else "spec.json"
    r=Reel(spec)
    if sys.argv[1]=="full":
        r.render(sys.argv[3] if len(sys.argv)>3 else "video_mute.mp4")
    else:
        # times de amostra = início de cada segmento + meio
        ts=[]
        for s in r.segs: ts.append(s["s"]+min(0.8,s["dur"]*0.4))
        r.contact_sheet("contact.png",ts); print("contact.png")
