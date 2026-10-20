#!/usr/bin/env python3
"""
build-une-meme-lumiere-videos.py — Capsules vidéo « Cinq voix, une même lumière » (TikTok, Reels, Shorts).

Une vidéo verticale 1080 × 1920 par thème : une carte d'ouverture, les cinq citations du visuel une à une, une
carte de fin. Mêmes citations que build-une-meme-lumiere-visuels.py (selection()) et même typographie : les cartes
sont des pages HTML rendues par Chrome sur fond transparent, posées par ffmpeg sur un fond animé (rayons de
lumière qui tournent lentement, en boucle sans raccord) avec des fondus enchaînés. La musique est une nappe
synthétisée ici même, libre de droits. Les textes restent hors des zones que couvrent les boutons de TikTok et
d'Instagram (150 px en haut, 320 px en bas, 120 px à droite).

Usage : python3 scripts/build-une-meme-lumiere-videos.py [--lang=en] [--theme=6]
        → docs/edition-amazon/kit-lancement/videos/{fr,en}/
Prérequis : Google Chrome et ffmpeg (python3 -m pip install --user imageio-ffmpeg suffit).
"""
import html
import importlib.util
import math
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("visuels", ROOT / "scripts" / "build-une-meme-lumiere-visuels.py")
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)
kdp, LANGUE = v.kdp, v.LANGUE

W, H, FPS = 1080, 1920, 30
FONDU, RECOUVREMENT = 0.6, 0.2  # secondes : fondu de chaque carte, et chevauchement bref entre deux cartes
SORTIE = ROOT / "docs" / "edition-amazon" / "kit-lancement" / "videos" / LANGUE
TRADITIONS = list(kdp.SYMBOLES)
T = {
    "fr": {"question": "Cinq religions, une même question", "fin": "E-book et broché · lien en bio",
           "ou": "Mobile Money · Apple Books · Kobo · Fnac · Amazon"},
    "en": {"question": "Five religions, one question", "fin": "E-book & paperback · link in bio",
           "ou": "Apple Books · Kobo · Barnes & Noble · Amazon · Mobile Money"},
}[LANGUE]


def ffmpeg():
    chemin = shutil.which("ffmpeg")
    if not chemin:
        try:
            import imageio_ffmpeg
            chemin = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            sys.exit("ffmpeg introuvable : python3 -m pip install --user imageio-ffmpeg")
    return chemin


# ─────────────────────────── cartes (HTML → PNG transparent) ───────────────────────────

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; background: transparent; }
body { position: relative; overflow: hidden; color: #f4ead2; font-family: 'EB Garamond', serif; }
.sym { font-family: 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Serif Devanagari', serif; }
.haut { position: absolute; top: 230px; left: 120px; right: 120px; text-align: center; font-size: 25px;
  letter-spacing: 0.32em; text-transform: uppercase; color: rgba(217,183,102,.85); }
.bloc { position: absolute; top: 330px; height: 1090px; left: 120px; right: 120px; display: flex;
  flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.cercle { width: 150px; height: 150px; flex: none; border-radius: 50%; border: 3px solid #d9b766;
  background: rgba(11,21,48,.55); display: flex; align-items: center; justify-content: center; font-size: 74px;
  color: #f1d58e; box-shadow: 0 0 60px rgba(255,214,140,.28); }
.trad { margin-top: 34px; font-size: 30px; letter-spacing: 0.3em; text-transform: uppercase; color: #d9b766; }
.q { margin-top: 42px; font-style: italic; font-size: 58px; line-height: 1.28; color: #f8efd8; text-wrap: balance;
  text-shadow: 0 2px 18px rgba(5,10,25,.6); }
.q em { font-style: normal; }
.q .sc { font-variant: small-caps; }
.src { margin-top: 36px; font-size: 25px; letter-spacing: 0.16em; text-transform: uppercase; color: #cdb98a; }
.points { position: absolute; top: 1470px; left: 120px; right: 120px; text-align: center; font-size: 40px;
  letter-spacing: 0.8em; color: rgba(217,183,102,.3); }
.points .on { color: #f1d58e; }
.question { font-style: italic; font-size: 46px; color: #e9d8ad; }
h1 { margin-top: 26px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 136px; line-height: 1.02;
  color: #f8efd8; text-shadow: 0 0 34px rgba(255,220,150,.32); white-space: nowrap; }
.filet { margin: 44px auto 0; width: 170px; border-top: 3px solid #d9b766; }
.rang { margin-top: 64px; display: flex; gap: 26px; }
.rang div { width: 104px; height: 104px; border-radius: 50%; border: 2px solid #d9b766; display: flex;
  align-items: center; justify-content: center; font-size: 50px; color: #f1d58e; background: rgba(11,21,48,.5); }
.couv { width: 500px; flex: none; border-radius: 6px; box-shadow: 0 34px 90px rgba(0,0,0,.6), 0 0 70px rgba(255,214,140,.2); }
.titre { margin-top: 56px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 70px;
  letter-spacing: 0.08em; text-transform: uppercase; color: #f8efd8; }
.auteur { margin-top: 14px; font-size: 30px; letter-spacing: 0.34em; text-transform: uppercase; color: #e9d8ad; }
.fin { margin-top: 44px; font-size: 36px; letter-spacing: 0.12em; text-transform: uppercase; color: #f1d58e; }
.ou { margin-top: 18px; font-size: 27px; color: #cdb98a; }
"""

AJUSTE = """<script>
document.fonts.ready.then(() => {
  const b = document.querySelector('.bloc'), q = document.querySelector('.q'), h = document.querySelector('h1');
  if (h) { let fs = 136; while (h.scrollWidth > b.clientWidth && fs > 70) { fs -= 2; h.style.fontSize = fs + 'px'; } }
  if (q) { let fs = 58; while (b.scrollHeight > b.clientHeight && fs > 34) { fs -= 1; q.style.fontSize = fs + 'px'; } }
});
</script>"""


def page(corps):
    return f"""<!doctype html><html lang="{LANGUE}"><head><meta charset="utf-8">
<style>{kdp.css_polices()}\n{CSS}</style></head><body>{corps}{AJUSTE}</body></html>"""


def carte_ouverture(n):
    rang = "".join(f'<div class="sym">{kdp.SYMBOLES[t]}</div>' for t in TRADITIONS)
    return page(f"""<div class="haut">{v.T['serie']}</div>
<div class="bloc"><div class="question">{T['question']}</div><h1>{html.escape(v.T['titres'][n - 1])}</h1>
<div class="filet"></div><div class="rang">{rang}</div></div>""")


def carte_citation(n, t, texte, source):
    points = "".join(f'<span class="sym{" on" if k == t else ""}">{kdp.SYMBOLES[x]}</span>'
                     for k, x in enumerate(TRADITIONS))
    return page(f"""<div class="haut">{kdp.TITRE} · {html.escape(v.T['titres'][n - 1])}</div>
<div class="bloc"><div class="cercle sym">{kdp.SYMBOLES[TRADITIONS[t]]}</div>
<div class="trad">{html.escape(TRADITIONS[t])}</div><div class="q">{v.en_html(texte)}</div>
<div class="src">{v.en_html(html.escape(source))}</div></div><div class="points">{points}</div>""")


def carte_fin():
    return page(f"""<div class="bloc" style="top:250px;height:1300px">
<img class="couv" src="{kdp.COVER_JPG.as_uri()}"><div class="titre">{kdp.TITRE}</div>
<div class="auteur">{kdp.AUTEUR}</div><div class="fin">{T['fin']}</div><div class="ou">{T['ou']}</div></div>""")


def capture(html_text, png, dossier):
    src = dossier / (png.stem + ".html")
    src.write_text(html_text, encoding="utf-8")
    subprocess.run([kdp.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--default-background-color=00000000", f"--window-size={W},{H}", "--virtual-time-budget=15000",
                    f"--screenshot={png}", src.as_uri()], check=True, capture_output=True)


# ─────────────────────────── fond animé et musique ───────────────────────────

def fond(chemin, secondes=24):
    """Boucle sans raccord, calculée en demi-résolution (le fond est très doux) puis agrandie et grainée une fois
    pour toutes (le grain évite les aplats en escalier) : deux familles de rayons tournent en sens contraires
    d'exactement un intervalle entre rayons par boucle, autour d'un halo derrière le symbole."""
    w, h = W // 2, H // 2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = (xx - w * .5) / w, (yy - h * .29) / w
    r, th = np.hypot(dx, dy), np.arctan2(dy, dx)
    nuit, bleu, or_ = (np.array(c, np.float32) for c in ((11, 21, 48), (31, 53, 104), (255, 214, 140)))
    base = nuit + (bleu - nuit) * np.exp(-r * 2.1)[..., None]
    halo = np.exp(-(r / .2) ** 2)[..., None] * .22
    pente = (np.exp(-r * 1.5) * np.clip(r / .05, 0, 1))[..., None]
    n_im = secondes * FPS
    proc = subprocess.Popen([ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
                             "-r", str(FPS), "-i", "-", "-vf", f"scale={W}:{H}:flags=lanczos,noise=alls=2:allf=t,format=yuv420p",
                             "-c:v", "libx264", "-preset", "medium", "-crf", "14", str(chemin)], stdin=subprocess.PIPE)
    for k in range(n_im):
        a = k / n_im
        rayons = (.5 + .5 * np.cos(24 * th - 2 * math.pi * a)) ** 9 * .7 \
            + (.5 + .5 * np.cos(12 * th + 2 * math.pi * a)) ** 14 * .45
        img = base + or_ * (halo + rayons[..., None] * pente * .1)
        proc.stdin.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())
    proc.stdin.close()
    if proc.wait():
        sys.exit("ffmpeg a échoué sur le fond animé")


def nappe(chemin, duree, sr=48000):
    """Nappe ambiante en ré mineur (ré m9, si♭ maj7, fa add9, do sus2), accords de 8 s fondus, bourdon grave,
    réverbération par convolution. Peu de notes, attaque lente : un fond discret sous la lecture."""
    t = np.arange(int(duree * sr)) / sr
    accords = [(146.83, 174.61, 220.0, 329.63), (116.54, 146.83, 174.61, 220.0),
               (174.61, 220.0, 261.63, 392.0), (130.81, 196.0, 293.66, 329.63)]
    sortie = np.zeros((2, t.size))
    for k in range(int(duree // 8) + 2):
        debut = k * 8 - 1.5
        env = np.clip((t - debut) / 3, 0, 1) * np.clip((debut + 11 - t) / 3, 0, 1)
        env = np.sin(env * math.pi / 2) ** 2
        if not env.any():
            continue
        for f in accords[k % 4]:
            for c, ecart in enumerate((-.0021, .0019)):
                sortie[c] += env * (np.sin(2 * math.pi * f * (1 + ecart) * t + c)
                                    + .22 * np.sin(4 * math.pi * f * t + .7 * c)) * .11
    for f, amp in ((73.42, .16), (110.0, .07)):
        sortie += amp * np.sin(2 * math.pi * f * t) * (.85 + .15 * np.sin(2 * math.pi * .07 * t))
    sortie += .025 * np.sin(2 * math.pi * 880 * t) * (.5 + .5 * np.sin(2 * math.pi * .11 * t)) ** 3
    rng, n_ir = np.random.default_rng(7), int(3.2 * sr)
    for c in (0, 1):
        ir = rng.standard_normal(n_ir) * np.exp(-np.arange(n_ir) / sr / .95)
        taille = 1 << (t.size + n_ir).bit_length()
        humide = np.fft.irfft(np.fft.rfft(sortie[c], taille) * np.fft.rfft(ir, taille), taille)[:t.size]
        sortie[c] = .62 * sortie[c] + .38 * humide / np.abs(humide).max() * np.abs(sortie[c]).max()
    sortie *= np.clip(t / 2.5, 0, 1) * np.clip((duree - t) / 3, 0, 1)
    sortie = sortie / np.abs(sortie).max() * .35  # crête à environ -9 dBFS
    with wave.open(str(chemin), "wb") as f:
        f.setnchannels(2), f.setsampwidth(2), f.setframerate(sr)
        f.writeframes((sortie.T * 32767).astype("<i2").tobytes())


# ─────────────────────────── montage ───────────────────────────

def duree_lecture(texte):
    mots = len(re.findall(r"\w+", re.sub(r"<[^>]+>", "", texte)))
    return min(11.0, max(5.5, mots / 2.7 + 2.0))


def monter(sortie, cartes, fond_mp4, musique):
    """cartes : [(png, durée)] enchaînées avec recouvrement ; chaque carte apparaît et s'efface en fondu et
    remonte de quelques pixels pendant qu'elle est à l'écran."""
    debuts, t = [], 0.0
    for _, d in cartes:
        debuts.append(t)
        t += d - RECOUVREMENT
    total = debuts[-1] + cartes[-1][1]
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", str(fond_mp4)]
    for png, d in cartes:
        cmd += ["-loop", "1", "-framerate", str(FPS), "-t", f"{d:.3f}", "-i", str(png)]
    cmd += ["-i", str(musique)]
    f = ["[0:v]format=yuv420p[b0]"]
    for i, ((_, d), s) in enumerate(zip(cartes, debuts), start=1):
        f.append(f"[{i}:v]format=rgba,fade=t=in:st=0:d={FONDU}:alpha=1,"
                 f"fade=t=out:st={d - FONDU:.3f}:d={FONDU}:alpha=1,setpts=PTS-STARTPTS+{s:.3f}/TB[c{i}]")
        f.append(f"[b{i - 1}][c{i}]overlay=x=0:y='26*(1-(t-{s:.3f})/{d:.3f})':eof_action=pass:format=yuv420[b{i}]")
    n = len(cartes)
    f.append(f"[b{n}]format=yuv420p[v]")
    cmd += ["-filter_complex", ";".join(f), "-map", "[v]", "-map", f"{n + 1}:a", "-t", f"{total:.3f}", "-r", str(FPS),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(sortie)]
    subprocess.run(cmd, check=True)
    return total


def capsule(n, cinq, fond_mp4, dossier):
    cartes = [(dossier / f"{n:02d}-0-ouverture.png", carte_ouverture(n), 3.8)]
    for t, texte, source in cinq:
        cartes.append((dossier / f"{n:02d}-{t + 1}.png", carte_citation(n, t, texte, source), duree_lecture(texte)))
    cartes.append((dossier / "fin.png", carte_fin(), 5.0))
    for png, h, _ in cartes:
        if not png.exists():
            capture(h, png, dossier)
    total = sum(d for *_, d in cartes) - RECOUVREMENT * (len(cartes) - 1)
    musique = dossier / f"{n:02d}-nappe.wav"
    nappe(musique, total)
    sortie = SORTIE / f"{n:02d}-{v.slug(v.T['titres'][n - 1])}.mp4"
    monter(sortie, [(png, d) for png, _, d in cartes], fond_mp4, musique)
    return sortie, total


def main():
    m = re.search(r"--theme[= ](\d+)", " ".join(sys.argv[1:]))
    themes = [int(m.group(1))] if m else range(1, 19)
    SORTIE.mkdir(parents=True, exist_ok=True)
    selection = v.selection()
    with tempfile.TemporaryDirectory(prefix="uml-videos-") as tmp:
        dossier = Path(tmp)
        fond_mp4 = dossier / "fond.mp4"
        fond(fond_mp4)
        for n in themes:
            sortie, total = capsule(n, selection[n - 1], fond_mp4, dossier)
            print(f"{sortie.relative_to(ROOT)} — {total:.1f} s")


if __name__ == "__main__":
    main()
