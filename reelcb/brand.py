#!/usr/bin/env python3
"""Sistema de marca editorial CB — cream, navy, serifa azul-aço. Pillow.
Self-contained: fontes empacotadas em fonts/ ao lado deste arquivo."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from functools import lru_cache

W, H = 1080, 1920
_HERE = os.path.dirname(os.path.abspath(__file__))
_FONTS = os.path.join(_HERE, "fonts")
INTER = os.path.join(_FONTS, "Inter.ttf")
PLAY  = os.path.join(_FONTS, "PlayfairItalic.ttf")
# Poppins: usa o do sistema se existir, senão cai pro Inter
_POP_SYS = "/usr/share/fonts/truetype/google-fonts/"
POP_B = (_POP_SYS + "Poppins-Bold.ttf") if os.path.exists(_POP_SYS + "Poppins-Bold.ttf") else INTER
POP_M = (_POP_SYS + "Poppins-Medium.ttf") if os.path.exists(_POP_SYS + "Poppins-Medium.ttf") else INTER

# paleta editorial CB
CREAM=(246,246,244); NAVY=(10,37,71); NAVY2=(23,43,74)
SERIF=(138,147,166); STEEL=(174,190,210); WHITE=(255,255,255)
SERIF_CAM=(156,178,208)          # serifa azul-aço (ênfase sobre câmera)
MUTE=(150,160,178); RED=(224,78,70); GREEN=(52,160,110); GOLD=(196,158,118)

@lru_cache(maxsize=64)
def inter(sz, w="Bold"):
    f=ImageFont.truetype(INTER, sz)
    try: f.set_variation_by_name(w)
    except Exception: pass
    return f

@lru_cache(maxsize=32)
def pop(sz, b=True):
    return ImageFont.truetype(POP_B if b else POP_M, sz)

@lru_cache(maxsize=24)
def play(sz, var="Medium Italic"):
    f=ImageFont.truetype(PLAY, sz)
    try: f.set_variation_by_name(var)
    except Exception: pass
    return f

@lru_cache(maxsize=2)
def cream_bg():
    cx,cy=0.5*W,0.42*H
    yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
    d=np.sqrt((xx-cx)**2+(yy-cy)**2)
    dmax=max(np.sqrt((cx-x)**2+(cy-y)**2) for x,y in [(0,0),(W,0),(0,H),(W,H)])
    t=np.clip(d/dmax,0,1)[...,None]
    c0=np.array([250,250,248],np.float32); c1=np.array([240,239,235],np.float32)
    return Image.fromarray((c0*(1-t)+c1*t).astype('uint8'),"RGB")

def accent_rule(d, cx, y, w=180):
    d.line([(cx-w//2,y),(cx+w//2,y)], fill=STEEL, width=4)

# ---- ícones (navy, simples) ----
def icon_calendar(d, cx, cy, s=120, label=None, fill=NAVY):
    x0,y0=cx-s//2,cy-s//2
    d.rounded_rectangle([x0,y0+s*0.12,x0+s,y0+s],radius=int(s*0.12),outline=fill,width=max(4,s//22))
    d.rectangle([x0,y0+s*0.12,x0+s,y0+s*0.34],fill=fill)
    d.line([(x0+s*0.28,y0),(x0+s*0.28,y0+s*0.22)],fill=fill,width=max(4,s//20))
    d.line([(x0+s*0.72,y0),(x0+s*0.72,y0+s*0.22)],fill=fill,width=max(4,s//20))
    if label:
        d.text((cx,y0+s*0.66),label,font=pop(int(s*0.34)),fill=WHITE if fill==NAVY else fill,anchor="mm")

def icon_person(d, cx, cy, s=70, fill=NAVY):
    d.ellipse([cx-s*0.22,cy-s*0.5,cx+s*0.22,cy-s*0.06],fill=fill)
    d.pieslice([cx-s*0.34,cy-s*0.02,cx+s*0.34,cy+s*0.7],180,360,fill=fill)

def check(d, cx, cy, r=26, col=GREEN):
    d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=col)
    d.line([(cx-r*0.45,cy+r*0.05),(cx-r*0.1,cy+r*0.4),(cx+r*0.5,cy-r*0.4)],
           fill=WHITE,width=max(4,r//5),joint="curve")

def cross(d, cx, cy, r=22, col=RED):
    d.ellipse([cx-r,cy-r,cx+r,cy+r],outline=col,width=max(3,r//6))
    o=r*0.45
    d.line([(cx-o,cy-o),(cx+o,cy+o)],fill=col,width=max(3,r//6))
    d.line([(cx+o,cy-o),(cx-o,cy+o)],fill=col,width=max(3,r//6))

def arrow(d, x0, y, x1, col=STEEL, wd=6):
    d.line([(x0,y),(x1,y)],fill=col,width=wd)
    d.polygon([(x1-18,y-14),(x1+6,y),(x1-18,y+14)],fill=col)

def chip(d, x, y, w, h, text, hot=False, muted=False):
    fnt=inter(int(h*0.40),"Bold")
    if hot:
        d.rounded_rectangle([x,y,x+w,y+h],radius=int(h*0.28),fill=NAVY)
        d.text((x+w//2,y+h//2),text,font=fnt,fill=CREAM,anchor="mm")
    else:
        col=(210,214,220) if muted else NAVY
        d.rounded_rectangle([x,y,x+w,y+h],radius=int(h*0.28),outline=col,width=3)
        d.text((x+w//2,y+h//2),text,font=fnt,fill=(190,194,200) if muted else NAVY,anchor="mm")

def month_grid(d, cx, cy, highlight=None, done=None, cols=4, rows=3):
    months=["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"]
    cw,ch,gap=150,78,16
    tw=cols*cw+(cols-1)*gap; th=rows*ch+(rows-1)*gap
    x0=cx-tw//2; y0=cy-th//2
    done=set(done or [])
    for i,m in enumerate(months):
        r,c=divmod(i,cols); x=x0+c*(cw+gap); y=y0+r*(ch+gap)
        chip(d,x,y,cw,ch,m,hot=(m==highlight),muted=(m in done))
