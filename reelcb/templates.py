#!/usr/bin/env python3
"""Biblioteca de TEMPLATES de cartão (parametrizados por conteúdo).
Cada cartão no spec.json escolhe um `type` e preenche os campos — nada de Python por vídeo.

Tipos: hero · checklist · compare · calendar · timeline · dm

render_card(card, tl, dur) -> RGBA 1080x1920
"""
import numpy as np
from PIL import Image, ImageDraw
from .brand import (W, H, cream_bg, inter, pop, play, accent_rule,
                    icon_calendar, icon_person, check, cross, arrow, chip, month_grid,
                    CREAM, NAVY, SERIF, STEEL, WHITE, MUTE, RED, GREEN, GOLD)

def ease(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def _bg(): return cream_bg().convert("RGBA")

ICONS={"calendar":icon_calendar, "person":icon_person}

def serif_line(d, text, cx, cy, fs=60, col=SERIF, var="Italic"):
    d.text((cx,cy),text,font=play(fs,var),fill=col,anchor="mm")

def big_navy(d, text, cx, cy, fs=200, w="ExtraBold", maxw=None):
    maxw=maxw or (W-150); f=inter(fs,w)
    while d.textlength(text,font=f)>maxw and fs>72:
        fs-=6; f=inter(fs,w)
    d.text((cx,cy),text,font=f,fill=NAVY,anchor="mm")

def _fade(board, tl, delay, dur_in, draw_fn):
    """Desenha draw_fn(draw) com fade-in de entrada (alpha por tempo)."""
    a=ease((tl-delay)/dur_in)
    if a<=0: return
    if a>=1:
        draw_fn(ImageDraw.Draw(board)); return
    tmp=Image.new("RGBA",(W,H),(0,0,0,0)); draw_fn(ImageDraw.Draw(tmp))
    board.alpha_composite(Image.fromarray((np.array(tmp)*np.array([1,1,1,a])).astype('uint8')))

def _top_icon(board, card, y=0.20):
    ic=card.get("icon")
    if ic in ICONS:
        ICONS[ic](ImageDraw.Draw(board), W//2, int(H*y), s=130,
                  label=card.get("icon_label"))
        return True
    return False

# ---------------- TEMPLATES ----------------
def t_hero(board, card, tl, dur):
    """Palavra/numero-herói grande + contexto serifado. Campos:
    kicker?, strike?, hero, lines?[], footer?, icon?"""
    d=ImageDraw.Draw(board)
    y=0.30
    if card.get("kicker"): serif_line(d,card["kicker"],W//2,int(H*0.19),fs=58)
    if card.get("strike"):
        f=inter(74,"Bold"); txt=card["strike"]
        d.text((W//2,int(H*0.275)),txt,font=f,fill=(176,182,192),anchor="mm")
        tw=d.textlength(txt,font=f)
        d.line([(W//2-tw/2,int(H*0.280)),(W//2+tw/2,int(H*0.280))],fill=RED,width=5)
        y=0.44
    big_navy(d,card["hero"],W//2,int(H*y),fs=card.get("hero_fs",200))
    accent_rule(d,W//2,int(H*(y+0.085)),card.get("rule_w",280))
    for i,ln in enumerate(card.get("lines",[])):
        serif_line(d,ln,W//2,int(H*(y+0.155+i*0.055)),fs=50)
    if card.get("footer"):
        d.text((W//2,int(H*0.80)),card["footer"],font=play(48,"SemiBold Italic"),fill=NAVY,anchor="mm")

def t_checklist(board, card, tl, dur):
    """Título + itens com check verde surgindo. Campos:
    title?(herói navy), kicker?(serif), icon?, items[], footer?"""
    d=ImageDraw.Draw(board)
    top=0.155
    if _top_icon(board,card,y=0.205):
        top=0.31
        if card.get("kicker"): serif_line(ImageDraw.Draw(board),card["kicker"],W//2,int(H*top),fs=56); top+=0.09
    else:
        if card.get("title"): big_navy(d,card["title"],W//2,int(H*top),fs=card.get("title_fs",92)); top+=0.065
        if card.get("kicker"): serif_line(d,card["kicker"],W//2,int(H*top),fs=52); top+=0.07
    items=card["items"]
    x0=W*card.get("x0",0.18); y0=H*(top+0.04); rowh=H*card.get("rowh",0.115)
    for i,it in enumerate(items):
        def mk(it=it,i=i):
            def fn(dd):
                y=int(y0+i*rowh)
                check(dd,int(x0),y,r=card.get("check_r",30),col=GREEN)
                dd.text((int(x0+64),y),it,font=inter(card.get("item_fs",54),"Medium"),fill=NAVY,anchor="lm")
            return fn
        _fade(board,tl,0.3+i*0.5,0.45,mk())
    if card.get("footer"):
        serif_line(ImageDraw.Draw(board),card["footer"],W//2,int(H*0.82),fs=48)

def _column(board, tl, x, ytop, colw, bh, col, delay):
    d=ImageDraw.Draw(board)
    ok = col.get("ok",True)
    titcol = NAVY if ok else (176,150,150)
    if ok:
        d.rounded_rectangle([x,ytop,x+colw,ytop+bh],radius=34,fill=(237,241,238),outline=(214,224,218),width=2)
    else:
        d.rounded_rectangle([x,ytop,x+colw,ytop+bh],radius=34,outline=(226,214,214),width=2)
    d.text((x+colw//2,ytop+int(bh*0.15)),col["title"],font=inter(52,"ExtraBold"),fill=titcol,anchor="mm")
    if ok:
        accent_rule(d,x+colw//2,ytop+int(bh*0.25),120)
    else:
        d.line([(x+colw//2-60,ytop+int(bh*0.25)),(x+colw//2+60,ytop+int(bh*0.25))],fill=(214,180,180),width=4)
    def fn(dd):
        for k,it in enumerate(col["items"]):
            yy=ytop+int(bh*0.38)+k*int(bh*0.185)
            iok = it.get("ok",ok)
            if iok: check(dd,x+int(colw*0.14),yy,r=22,col=GREEN)
            else:   cross(dd,x+int(colw*0.14),yy,r=18,col=RED)
            dd.text((x+int(colw*0.24),yy),it["text"],font=inter(36,"Medium"),
                    fill=NAVY if iok else (150,120,120),anchor="lm")
    _fade(board,tl,delay,0.45,fn)

def t_compare(board, card, tl, dur):
    """Duas colunas lado a lado. Campos: kicker?, left{title,items[{text,ok}]}, right{...}, footer?"""
    d=ImageDraw.Draw(board)
    if card.get("kicker"): serif_line(d,card["kicker"],W//2,int(H*0.165),fs=52)
    colw=int(W*0.40); gap=int(W*0.06)
    x1=W//2-gap//2-colw; x2=W//2+gap//2
    ytop=int(H*0.26); bh=int(H*0.40)
    _column(board,tl,x1,ytop,colw,bh,card["left"],0.35)
    _column(board,tl,x2,ytop,colw,bh,card["right"],0.9)
    if card.get("footer"):
        serif_line(ImageDraw.Draw(board),card["footer"],W//2,int(H*0.74),fs=52)

def t_calendar(board, card, tl, dur):
    """Grade de meses com destaque. Campos: kicker?, hero?, highlight, done?[], footer?"""
    d=ImageDraw.Draw(board)
    if card.get("hero"): big_navy(d,card["hero"],W//2,int(H*0.21),fs=card.get("hero_fs",150))
    if card.get("kicker"): serif_line(d,card["kicker"],W//2,int(H*0.30),fs=50)
    month_grid(d,W//2,int(H*0.56),highlight=card.get("highlight"),done=card.get("done"))
    if card.get("footer"):
        d.text((W//2,int(H*0.80)),card["footer"],font=play(50,"Italic"),fill=SERIF,anchor="mm")

def t_timeline(board, card, tl, dur):
    """Linha do tempo de->para com seta. Campos: title?, from, to, note?, hot?"""
    d=ImageDraw.Draw(board)
    if card.get("title"): big_navy(d,card["title"],W//2,int(H*0.27),fs=card.get("title_fs",120))
    if card.get("note"): serif_line(d,card["note"],W//2,int(H*0.40),fs=52)
    y=int(H*0.58); cw=240; ch=108
    chip(d,int(W//2-cw-50),y-ch//2,cw,ch,card["from"],muted=True)
    p=ease(tl/max(dur*0.6,1e-3))
    arrow(d,int(W//2-40),y,int(W//2-40+p*80),col=STEEL,wd=7)
    if p>0.55:
        chip(d,int(W//2+50),y-ch//2,cw,ch,card["to"],hot=card.get("hot",True))

def t_dm(board, card, tl, dur):
    """Mockup de DM/comentário digitando a isca + resposta. Campos:
    kicker?, hero?, header?, msg, reply?"""
    d=ImageDraw.Draw(board)
    if card.get("kicker"): serif_line(d,card["kicker"],W//2,int(H*0.18),fs=56)
    if card.get("hero"): big_navy(d,card["hero"],W//2,int(H*0.27),fs=card.get("hero_fs",120))
    cx0,cy0,cw,ch=90,int(H*0.375),900,int(H*0.38)
    d.rounded_rectangle([cx0,cy0,cx0+cw,cy0+ch],radius=44,fill=WHITE,outline=(226,226,228),width=2)
    d.ellipse([cx0+34,cy0+30,cx0+34+56,cy0+30+56],fill=(224,227,232))
    d.text((cx0+110,cy0+58),card.get("header","Direct"),font=inter(34,"SemiBold"),fill=NAVY,anchor="lm")
    d.line([(cx0+28,cy0+110),(cx0+cw-28,cy0+110)],fill=(234,234,236),width=2)
    msg=card["msg"]; typ=dur*0.5
    n=int(np.clip(tl/max(typ,1e-3),0,1)*len(msg)); shown=msg[:n]
    bw=min(cw-200, 120+int(d.textlength(shown,font=inter(34,"Medium"))))
    by=cy0+170
    d.rounded_rectangle([cx0+cw-40-bw,by,cx0+cw-40,by+78],radius=28,fill=NAVY)
    d.text((cx0+cw-40-bw+28,by+39),shown,font=inter(34,"Medium"),fill=WHITE,anchor="lm")
    if card.get("reply") and tl>typ+0.2:
        ry=by+110; rep=card["reply"]
        rw=120+int(d.textlength(rep,font=inter(34,"Medium")))
        d.rounded_rectangle([cx0+40,ry,cx0+40+rw,ry+74],radius=26,fill=(238,239,242))
        d.text((cx0+70,ry+37),rep,font=inter(34,"Medium"),fill=NAVY,anchor="lm")
        check(d,cx0+40+rw-34,ry+37,r=20,col=GREEN)
    iy=cy0+ch-72
    d.rounded_rectangle([cx0+40,iy-38,cx0+cw-120,iy+38],radius=34,outline=(222,222,226),width=2)
    if tl<typ and int(tl*2)%2==0:
        d.line([(cx0+72,iy-24),(cx0+72,iy+24)],fill=NAVY,width=3)
    sx=cx0+cw-78
    d.ellipse([sx-38,iy-38,sx+38,iy+38],fill=NAVY)
    d.polygon([(sx-13,iy-11),(sx+15,iy),(sx-13,iy+11),(sx-5,iy)],fill=WHITE)

TEMPLATES={"hero":t_hero,"checklist":t_checklist,"compare":t_compare,
           "calendar":t_calendar,"timeline":t_timeline,"dm":t_dm}

def render_card(card, tl, dur):
    b=_bg()
    fn=TEMPLATES.get(card["type"])
    if fn is None:
        raise ValueError(f"template desconhecido: {card['type']!r} (tipos: {list(TEMPLATES)})")
    fn(b, card, tl, dur)
    return b

if __name__=="__main__":
    # galeria de teste: um exemplo de cada template
    import os
    os.makedirs("gallery",exist_ok=True)
    demo={
     "hero":{"type":"hero","strike":"não é + dinheiro","hero":"CLAREZA",
             "lines":["saber aonde o dinheiro vai estar,","quando vai apertar"]},
     "checklist":{"type":"checklist","title":"O QUE SE PREPARA","kicker":"ainda em outubro",
             "items":["Fluxo de caixa projetado","Encargos provisionados","Reserva direcionada","Tudo separado antes"]},
     "compare":{"type":"compare","kicker":"planejar o encerramento em",
             "left":{"title":"OUTUBRO","ok":True,"items":[{"text":"com calma"},{"text":"dados frescos"},{"text":"dez. tranquilo"}]},
             "right":{"title":"NOVEMBRO","ok":False,"items":[{"text":"no susto"},{"text":"correndo"},{"text":"sem margem"}]},
             "footer":"muda tudo lá na frente"},
     "calendar":{"type":"calendar","hero":"A JANELA","kicker":"outubro é o mês","highlight":"OUT","footer":"recalcular a rota"},
     "timeline":{"type":"timeline","title":"REFORMA","note":"entra em fase de transição","from":"2026","to":"2027","hot":True},
     "dm":{"type":"dm","kicker":"quer entender como funciona?","hero":"CHAMA NA DM",
             "msg":"Quero planejar meu fim de ano","reply":"Bora trocar uma ideia"},
    }
    for sid,c in demo.items():
        render_card(c,1.4,3.0).convert("RGB").save(f"gallery/card_{sid}.png")
    print("gallery ok:", list(demo))
