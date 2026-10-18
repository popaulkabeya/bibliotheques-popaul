#!/usr/bin/env python3
"""
build-une-meme-lumiere-couverture.py — Couvertures de l'édition Amazon d'« Une même lumière ».

  - Couverture du broché (KDP) : un seul PDF, 4e de couverture + dos + 1re, fonds perdus de
    0,125 po sur chaque bord. La largeur du dos se calcule sur le nombre de pages de l'intérieur
    (papier crème : 0,0025 po par page) ; relancer ce script si l'intérieur change de longueur.
  - Couverture de l'e-book : JPEG 1600 × 2560 px (rapport 1,6 recommandé par KDP).

Le dessin est vectoriel (SVG et texte), les polices sont incorporées. La zone du code-barres,
en bas à droite de la 4e de couverture, est laissée libre : KDP y imprime l'ISBN.

Usage : python3 scripts/build-une-meme-lumiere-couverture.py [--lang=en]   (après build-une-meme-lumiere-kdp.py)
"""
import importlib.util
import math
import subprocess
import tempfile
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("kdp", ROOT / "scripts" / "build-une-meme-lumiere-kdp.py")
kdp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kdp)

COUV_PDF = kdp.OUT / kdp.E["fichiers"]["couverture"]
BLEED, TRIM_W, TRIM_H, PAR_PAGE = 0.125, 5.5, 8.5, 0.0025  # pouces ; papier crème

SYMBOLES = [(glyphe, nom) for nom, glyphe in kdp.SYMBOLES.items()]

QUATRIEME = {"fr": """
<p class="exergue">« Qu'on ne fasse jamais à autrui ce que l'on tient pour nuisible à soi-même. »</p>
<p class="source">Mahâbhârata</p>
<p>La même règle se lit dans le Talmud, dans les paroles du Bouddha, dans l'Évangile et dans les hadiths
du Prophète. Ces traditions sont nées à des siècles et à des milliers de kilomètres de distance, en des mondes
qui, souvent, ne se connaissaient pas. Et pourtant, devant les mêmes questions — la souffrance, la mort, la manière
de traiter son prochain —, elles cherchent la même chose, et la disent presque dans les mêmes mots.
Simple hasard, ou lumière commune&#8239;?</p>
<p><em>Une même lumière</em> ouvre côte à côte les Écritures des cinq grandes religions — les Veda et la
Bhagavad-Gîtâ, la Torah et le Talmud, le Dhammapada, l'Évangile, le Coran —, présente leurs fondateurs, et les laisse parler sur dix-huit
thèmes essentiels&#8239;: Dieu et l'Absolu, la compassion, le pardon, le don, la vérité, la prière, le cœur,
la mort, et jusqu'à l'expérience des mystiques.</p>
<ul>
<li>près de 300 citations, relues dans leurs sources et données dans des traductions classiques&#8239;;</li>
<li>pour chaque thème, une synthèse claire&#8239;: ce qui converge, et ce qui nuance&#8239;;</li>
<li>les mystiques des cinq traditions — Kabîr, la Kabbale, Shantideva, Jean de la Croix, Ghazâlî — face à la même nuée et à la même lumière&#8239;;</li>
<li>une partie entière sur ce qui distingue les cinq traditions, car rapprocher n'est pas confondre&#8239;; et, en annexe, une sixième lampe&#8239;: le Tao Te King.</li>
</ul>
<p>Un livre qui compare sans prétendre que tout se vaut&#8239;: pour le croyant curieux des autres traditions,
pour le pasteur, l'enseignant et l'étudiant, et pour quiconque cherche, sous la diversité des langues sacrées, ce qui
éclaire tous les hommes.</p>
""", "en": """
<p class="exergue">“Let one never do to another what one holds to be harmful to oneself.”</p>
<p class="source">Mahabharata</p>
<p>The same rule can be read in the Talmud, in the words of the Buddha, in the Gospel and in the hadiths
of the Prophet. These traditions were born centuries and thousands of miles apart, in worlds that often
did not know one another. Yet before the same questions — suffering, death, how to treat one's neighbor —
they seek the same thing, and say it in almost the same words.
Mere coincidence, or a common light?</p>
<p><em>The Same Light</em> sets side by side the Scriptures of the five great religions (the Vedas and the
Bhagavad-Gita, the Torah and the Talmud, the Dhammapada, the Gospel, the Qur’an), introduces their founders, and lets
them speak on eighteen essential themes: God and the Absolute, compassion, forgiveness, giving, truth, prayer, the heart, death, and even
the experience of the mystics.</p>
<ul>
<li>nearly 300 quotations, each checked against its source and drawn from classic public-domain translations;</li>
<li>for each theme, a clear summary: where the traditions converge, and where they differ;</li>
<li>the mystics of the five traditions, from Kabir and the Kabbalah to Shantideva, John of the Cross and Ghazali, facing the same cloud and the same light;</li>
<li>a whole part on what sets the five traditions apart, because to bring together is not to confuse; and, in the appendix, a sixth lamp: the Tao&nbsp;Te&nbsp;Ching.</li>
</ul>
<p>A book that compares without claiming that all faiths are the same: for believers curious about other traditions,
for pastors, teachers and students, and for anyone who seeks, beneath the diversity of sacred languages, the light that shines
on every human being.</p>
"""}[kdp.LANGUE]
RAYON = {"fr": "Religions comparées · Spiritualité", "en": "Comparative Religion · Spirituality"}[kdp.LANGUE]
# Sens du titre sur le dos : de bas en haut en France, de haut en bas aux États-Unis et au Royaume-Uni.
SENS_DOS = {"fr": "bas-haut", "en": "haut-bas"}[kdp.LANGUE]


def rayons(n=48):
    """Rayons de lumière autour du centre des symboles : triangles fins, dégradé radial (vectoriel)."""
    tri = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = 0.018 if k % 2 else 0.032
        p1 = (50 + 70 * math.cos(a - d), 50 + 70 * math.sin(a - d))
        p2 = (50 + 70 * math.cos(a + d), 50 + 70 * math.sin(a + d))
        tri.append(f'<polygon points="50,50 {p1[0]:.2f},{p1[1]:.2f} {p2[0]:.2f},{p2[1]:.2f}"/>')
    return f"""<svg class="rayons" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
<defs><radialGradient id="r" cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffe7b0" stop-opacity="0.55"/><stop offset="0.45" stop-color="#e8c27a" stop-opacity="0.16"/>
<stop offset="1" stop-color="#e8c27a" stop-opacity="0"/></radialGradient>
<radialGradient id="halo" cx="50" cy="50" r="30" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#fff3d6" stop-opacity="0.5"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/></radialGradient></defs>
<g fill="url(#r)">{''.join(tri)}</g><circle cx="50" cy="50" r="30" fill="url(#halo)"/></svg>"""


CSS = """
@page { size: %(W)sin %(H)sin; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { width: %(W)sin; height: %(H)sin; position: relative; overflow: hidden;
  background: #0d1a36; color: #f4ead2; font-family: 'EB Garamond', serif; }
.fond { position: absolute; inset: 0;
  background: radial-gradient(ellipse at 76%% 46%%, #1d3263 0%%, #12224a 38%%, #0b1530 75%%); }
.sym { font-family: 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Serif Devanagari', serif; }

/* 1re de couverture : une boîte au format rogné, en unités relatives pour servir aussi à l'e-book */
.une { position: absolute; container-type: size; overflow: hidden; }
.une .rayons { position: absolute; left: -20cqw; top: 18cqh; width: 140cqw; height: 72cqh; }
.une .auteur { position: absolute; top: 7.5cqh; width: 100%%; text-align: center; font-size: 4.3cqw;
  letter-spacing: 0.32em; text-transform: uppercase; color: #e9d8ad; }
.une .titre { position: absolute; top: 15.5cqh; width: 100%%; text-align: center; font-family: 'Cormorant Garamond', serif;
  font-weight: 600; font-size: 13.2cqw; line-height: 1.02; letter-spacing: 0.06em; text-transform: uppercase;
  color: #f8efd8; text-shadow: 0 0 2.5cqw rgba(255, 220, 150, 0.35); }
.une .cercle { position: absolute; left: 50%%; top: 54cqh; width: 0; height: 0; }
.une .s { position: absolute; width: 13.5cqw; height: 13.5cqw; margin: -6.75cqw 0 0 -6.75cqw; border-radius: 50%%;
  border: 0.45cqw solid #d9b766; background: rgba(11, 21, 48, 0.72); display: flex; align-items: center;
  justify-content: center; font-size: 6.6cqw; color: #f1d58e; }
.une .centre { position: absolute; width: 9cqw; height: 9cqw; margin: -4.5cqw 0 0 -4.5cqw; border-radius: 50%%;
  background: radial-gradient(circle, #fffaf0 0%%, #ffe3a3 45%%, rgba(255, 214, 140, 0) 72%%); }
.une .sous { position: absolute; top: 76.5cqh; left: 10cqw; right: 10cqw; text-align: center; font-style: italic;
  font-family: 'Cormorant Garamond', serif; font-weight: 500; font-size: 5.6cqw; line-height: 1.25; color: #f1e6c8; }
.une .filet { position: absolute; top: 74cqh; left: 50%%; width: 22cqw; margin-left: -11cqw; border-top: 0.3cqw solid #d9b766; }
.une .trad { position: absolute; bottom: 5cqh; width: 100%%; text-align: center; font-size: 2.9cqw; line-height: 1.5;
  letter-spacing: 0.22em; text-transform: uppercase; color: #cdb98a; }

/* 4e de couverture */
.dos4 { position: absolute; padding: 0.6in 0.5in 0.5in 0.5in; font-size: 11pt; line-height: 1.45; color: #efe5cc; }
.dos4 p { margin: 0 0 10pt; text-align: justify; hyphens: auto; }
.dos4 .exergue { font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 500; font-size: 17pt;
  line-height: 1.25; text-align: center !important; color: #f6e7bd; margin-bottom: 4pt; hyphens: none !important;
  text-wrap: balance; }
.dos4 .source { text-align: center; font-size: 8.5pt; letter-spacing: 0.25em; text-transform: uppercase; color: #cdb98a;
  margin-bottom: 16pt; }
.dos4 ul { margin: 0 0 9pt; padding-left: 1.1em; }
.dos4 li { margin-bottom: 4pt; }
.dos4 li::marker { content: "✦  "; color: #d9b766; font-size: 7pt; font-family: 'Noto Sans Symbols 2', serif; }
.dos4 .syms { position: absolute; left: 0.5in; bottom: 0.62in; font-size: 13pt; letter-spacing: 0.55em; color: #d9b766; }
.dos4 .rayon { position: absolute; left: 0.5in; bottom: 0.38in; font-size: 7.5pt; letter-spacing: 0.2em;
  text-transform: uppercase; color: #b9a678; }

/* dos */
.dos { position: absolute; top: 0; display: flex; align-items: center; justify-content: center; }
.dos .txt { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-size: %(SF)spt;
  letter-spacing: 0.16em; color: #f4ead2; }
.dos.haut-bas .txt { transform: none; }
.dos .txt b { font-family: 'Cormorant Garamond', serif; font-weight: 600; text-transform: uppercase; }
.dos .txt i { font-style: normal; color: #d9b766; margin-inline: 0.9em; font-family: 'Noto Sans Symbols 2', serif; }
"""


def une_html():
    pos = []
    for k, (glyphe, nom) in enumerate(SYMBOLES):
        a = -math.pi / 2 + 2 * math.pi * k / len(SYMBOLES)
        x, y = 21 * math.cos(a), 21 * math.sin(a)  # en cqw autour du centre
        pos.append(f'<div class="s sym" style="left:{x:.2f}cqw;top:{y:.2f}cqw" title="{nom}">{glyphe}</div>')
    return f"""{rayons()}
<div class="auteur">{kdp.AUTEUR}</div>
<div class="titre">{kdp.E["titre_lignes"]}</div>
<div class="cercle"><div class="centre"></div>{''.join(pos)}</div>
<div class="filet"></div>
<div class="sous">{kdp.SOUS_TITRE}</div>
<div class="trad">{" · ".join(n for _, n in SYMBOLES[:3])}<br>{" · ".join(n for _, n in SYMBOLES[3:])}</div>"""


def page(W, H, corps, spine_pt=8):
    css = CSS % {"W": f"{W:.4f}", "H": f"{H:.4f}", "SF": spine_pt}
    return f"""<!doctype html><html lang="{kdp.LANGUE}"><head><meta charset="utf-8">
<style>{kdp.css_polices()}\n{css}</style></head><body><div class="fond"></div>{corps}</body></html>"""


def chrome(args, html_text, nom):
    tmp = Path(tempfile.mkdtemp(prefix="uml-couv-")) / nom
    tmp.write_text(html_text, encoding="utf-8")
    subprocess.run([kdp.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--virtual-time-budget=20000", *args, tmp.as_uri()], check=True, capture_output=True)


def main():
    interieur = fitz.open(kdp.PDF_OUT)
    pages = interieur.page_count + interieur.page_count % 2  # KDP compte un nombre pair de pages
    dos = pages * PAR_PAGE
    W, H = 2 * (BLEED + TRIM_W) + dos, TRIM_H + 2 * BLEED
    x_dos = BLEED + TRIM_W
    x_une = x_dos + dos
    corps = f"""
<div class="dos4" style="left:{BLEED}in;top:{BLEED}in;width:{TRIM_W}in;height:{TRIM_H}in">{QUATRIEME}
  <div class="syms sym">{' '.join(g for g, _ in SYMBOLES)}</div>
  <div class="rayon">{RAYON}</div></div>
<div class="dos {SENS_DOS}" style="left:{x_dos}in;width:{dos}in;height:{H}in">
  <div class="txt"><b>{kdp.TITRE}</b><i>✦</i>{kdp.AUTEUR}</div></div>
<div class="une" style="left:{x_une}in;top:{BLEED}in;width:{TRIM_W}in;height:{TRIM_H}in">{une_html()}</div>"""
    # le fond de la 1re déborde sur les fonds perdus ; seul le contenu reste dans le format rogné
    # Chrome arrondit la page au pixel : on la rend un peu plus large, puis on la recadre à la cote exacte de KDP.
    brut = COUV_PDF.with_suffix(".brut.pdf")
    chrome(["--no-pdf-header-footer", f"--print-to-pdf={brut}"], page(W + 0.02, H + 0.02, corps, spine_pt=7.5),
           "couverture.html")
    d = fitz.open(brut)
    d[0].set_mediabox(fitz.Rect(0, 0, W * 72, H * 72))
    d.save(COUV_PDF, garbage=3, deflate=True)
    brut.unlink()
    d = fitz.open(COUV_PDF)
    r = d[0].rect
    print(f"Couverture broché : {COUV_PDF.relative_to(ROOT)} — {d.page_count} page, {r.width / 72:.3f} × {r.height / 72:.3f} in "
          f"(attendu {W:.3f} × {H:.3f}), dos {dos:.3f} in pour {pages} pages")

    # e-book : la même 1re, au rapport 1,6 ; capture à 1600 × 2560 px
    png = kdp.OUT / "couverture-ebook.png"
    ebook = f'<div class="une" style="left:0;top:0;width:1600px;height:2560px">{une_html()}</div>'
    html_e = page(1600 / 96, 2560 / 96, ebook)
    chrome([f"--screenshot={png}", "--window-size=1600,2560", "--force-device-scale-factor=1"], html_e, "ebook.html")
    Image.open(png).convert("RGB").save(kdp.COVER_JPG, "JPEG", quality=92, dpi=(300, 300))
    png.unlink()
    print(f"Couverture e-book : {kdp.COVER_JPG.relative_to(ROOT)} — {Image.open(kdp.COVER_JPG).size}")


if __name__ == "__main__":
    main()
