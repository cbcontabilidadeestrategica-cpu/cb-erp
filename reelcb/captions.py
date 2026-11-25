#!/usr/bin/env python3
"""Legendas editoriais: Inter minúsculo branco + ênfase Playfair azul-aço, sombra suave."""
from PIL import Image, ImageDraw, ImageFilter
from .brand import W, H, inter, play, WHITE, SERIF_CAM

def _soft(img, xy, text, font, fill, anchor="mm", blur=9, off=5, thin=(14,18,28)):
    """Texto com sombra suave + contorno fino (refinado, como a referência)."""
    lay=Image.new("RGBA",img.size,(0,0,0,0))
    ImageDraw.Draw(lay).text((xy[0],xy[1]+off),text,font=font,fill=(0,0,0,150),anchor=anchor)
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(blur)))
    ImageDraw.Draw(img).text(xy,text,font=font,fill=fill,anchor=anchor,stroke_width=2,stroke_fill=thin)

def _fit(d, text, fn, maxw, start, mins):
    s=start; f=fn(s)
    while d.textlength(text,font=f)>maxw and s>mins: s-=3; f=fn(s)
    return f

def draw_caption(img, main, emph=None, cx=W//2):
    """main = linha sans minúscula (branca). emph = ênfase serifada itálica (azul-aço)."""
    d=ImageDraw.Draw(img)
    if emph and not main:
        fe=_fit(d,emph,lambda s:play(s,"SemiBold Italic"),W-130,128,70)
        _soft(img,(cx,1500),emph,fe,SERIF_CAM,blur=10,off=5)
    elif emph:
        fm=_fit(d,main,lambda s:inter(s,"Bold"),W-140,62,40)
        _soft(img,(cx,1452),main,fm,WHITE,blur=9,off=4)
        fe=_fit(d,emph,lambda s:play(s,"SemiBold Italic"),W-130,112,60)
        _soft(img,(cx,1566),emph,fe,SERIF_CAM,blur=10,off=5)
    else:
        fm=_fit(d,main,lambda s:inter(s,"Bold"),W-140,66,40)
        _soft(img,(cx,1500),main,fm,WHITE,blur=9,off=4)
