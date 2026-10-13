#!/usr/bin/env python3
"""
build-livret-pdf.py — Reconstruit le PDF mis en page des « Trois Prières du Jour »
à partir du texte du livret (Livret-Trois-Prieres-du-Jour-FR.md).

Le PDF d'origine avait perdu sa source : chaque modification du texte le laissait
en retard. Ce script en fait un dérivé du markdown — le texte ne se retape plus.

Mise en page : couverture marine, puis deux pages par office (Notre Père, invocation
et Sceau ; puis Psaume 23, déclarations et clôture), papier crème, cadre doré.
Rendu par Chrome en mode sans interface ; les polices viennent de Google Fonts
(réseau nécessaire à la fabrication, pas à la lecture : elles sont incorporées).

Usage : python3 scripts/build-livret-pdf.py [--out=chemin.pdf] [--keep-html]
"""
import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Livret-Trois-Prieres-du-Jour" / "Livret-Trois-Prieres-du-Jour-FR.md"
DEFAULT_OUT = ROOT / "Livret-Trois-Prieres-du-Jour" / "Livret-Trois-Prieres-du-Jour-FR.pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

esc = html.escape


# ─────────────────────────── lecture du markdown ───────────────────────────

def typo(l):
    """Typographie française : ni « : ; ! ? » ni les guillemets ne doivent se retrouver seuls en début de ligne."""
    l = re.sub(r" ([:;!?»])", "\u00a0\\1", l)
    return re.sub(r"« ", "«\u00a0", l)


def lignes_vers_html(lignes):
    """Une strophe : les retours à la ligne du livret sont conservés."""
    return "<br>".join(esc(typo(l.strip())) for l in lignes if l.strip())


def paragraphes(bloc):
    """Découpe un bloc de lignes en paragraphes (séparés par une ligne vide)."""
    paras, cur = [], []
    for l in bloc:
        if l.strip():
            cur.append(l.rstrip())
        elif cur:
            paras.append(cur)
            cur = []
    if cur:
        paras.append(cur)
    return paras


def lire_livret():
    texte = SRC.read_text(encoding="utf-8")
    entete, *offices = re.split(r"(?m)^## ", texte)
    couv = [l.strip() for l in entete.splitlines()]
    sous_titre = next(l for l in couv if l.startswith("*Invocations")).strip("*")
    epigraphe = next(l for l in couv if l.startswith(">")).lstrip("> ").strip()
    result = []
    for o in offices:
        lignes = o.rstrip().splitlines()
        titre = lignes[0].strip()
        m = re.match(r"^(I+) · Invocation (du|de) (\w+) — (\d+) h (\d+)", titre)
        if not m:
            raise SystemExit(f"Titre d'office non reconnu : {titre!r}")
        num, art, nom, h, mn = m.groups()
        corps = lignes[1:]
        # sépare les sections par leurs titres ###/#### ; --- ferme l'office
        sections, cur = [("intro", None, [])], None
        for l in corps:
            if l.strip() == "---":
                continue
            h3 = re.match(r"^(#{3,4})\s+(.*)$", l)
            if h3:
                kind = "h4" if len(h3.group(1)) == 4 else "h3"
                sections.append((kind, h3.group(2).strip(), []))
            else:
                sections[-1][2].append(l)
        result.append(dict(num=num, art=art, nom=nom, heure=f"{int(h)} H {mn}", sections=sections))
    return dict(sous_titre=sous_titre, epigraphe=epigraphe, offices=result)


# ─────────────────────────── gabarit HTML ───────────────────────────

CSS = """
@page { size: 210mm 297mm; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { font-family: 'EB Garamond', 'Cormorant Garamond', Garamond, serif; color: #1b2a4a }
:root { --navy:#1b2a4a; --gold:#a8803a; --gold-l:#c9a45c; --cream:#faf6ec }

.page { position: relative; width: 210mm; height: 297mm; overflow: hidden;
        page-break-after: always; break-after: page; background: var(--cream) }
.page:last-child { page-break-after: auto; break-after: auto }

.f1 { position:absolute; inset:14mm; border:.5pt solid rgba(201,164,92,.75) }
.f2 { position:absolute; inset:16.5mm; border:.3pt solid rgba(201,164,92,.5) }
.br { position:absolute; width:8mm; height:8mm; border:0 solid var(--navy) }
.br.tl { top:11mm; left:11mm; border-top-width:.8pt; border-left-width:.8pt; border-top-left-radius:2.2mm }
.br.tr { top:11mm; right:11mm; border-top-width:.8pt; border-right-width:.8pt; border-top-right-radius:2.2mm }
.br.bl { bottom:11mm; left:11mm; border-bottom-width:.8pt; border-left-width:.8pt; border-bottom-left-radius:2.2mm }
.br.brr { bottom:11mm; right:11mm; border-bottom-width:.8pt; border-right-width:.8pt; border-bottom-right-radius:2.2mm }

/* couverture */
.cover { background: linear-gradient(180deg,#1a2341 0%,#262f5a 100%); color:#faf6ec }
.cover .f1 { border-color: rgba(201,164,92,.7) }
.cover .f2 { border-color: rgba(201,164,92,.35) }
.cover .br { border-color:#0f1630 }
.cover .center { position:absolute; left:0; right:0; top:84mm; text-align:center }
.cover .kicker { margin-top:7mm; font:500 9.5pt 'Cormorant Garamond',serif; letter-spacing:.42em; color:var(--gold-l);
                 text-transform:uppercase; padding-left:.42em }
.cover h1 { margin-top:11mm; font:600 41pt/1.12 'Playfair Display',serif; color:#faf6ec; letter-spacing:.005em }
.cover h1 em { display:block; font:italic 600 40pt/1.1 'Cormorant Garamond',serif; color:var(--gold-l) }
.cover .rule { width:38mm; height:.5pt; background:rgba(201,164,92,.75); margin:9mm auto }
.cover .sub { font:italic 500 15pt/1.5 'Cormorant Garamond',serif; color:#f1ead8 }
.cover .epi { position:absolute; left:0; right:0; bottom:44mm; text-align:center;
              font:italic 400 11pt 'Cormorant Garamond',serif; color:var(--gold-l) }

/* offices */
.inner { position:absolute; left:30mm; right:30mm; top:27mm; bottom:30mm }
.glyph { text-align:center; height:15mm }
.glyph svg { height:13mm; width:auto; overflow:visible }
h2 { margin-top:4mm; text-align:center; font:600 25pt/1.15 'Playfair Display',serif; color:var(--navy) }
h2 em { font-style:italic; font-weight:500; color:var(--gold) }
.heure { margin-top:2.4mm; text-align:center; font:600 10pt 'Cormorant Garamond',serif; letter-spacing:.38em;
         color:#8f6a28; padding-left:.38em }
.mots { margin-top:1.6mm; text-align:center; font:italic 500 11.5pt 'Cormorant Garamond',serif; color:var(--navy) }
.sep { display:flex; align-items:center; justify-content:center; gap:3mm; margin:3mm auto 7mm }
.sep i { display:block; width:14mm; height:.4pt; background:rgba(201,164,92,.8) }
.sep b { font-size:6.5pt; color:var(--gold-l); font-weight:400 }

p { font-size:11.2pt; line-height:1.52; margin-bottom:3.6mm }
p.np::first-letter { font:600 1.75em 'Playfair Display',serif; color:var(--gold); line-height:1 }   /* lettrine en ligne : n'écarte pas les vers */
.stars { text-align:center; color:var(--gold-l); letter-spacing:.9em; font-size:8pt; margin:1mm 0 4.2mm; padding-left:.9em }
.lead { font:italic 600 12pt 'Cormorant Garamond',serif; color:var(--gold); margin-bottom:2.2mm }

.seal { margin:5mm 0 5.5mm; padding:3.4mm 0 1.6mm; border-top:.4pt solid rgba(201,164,92,.7);
        border-bottom:.4pt solid rgba(201,164,92,.7); text-align:center }
.seal .label { font:600 8.6pt 'Cormorant Garamond',serif; letter-spacing:.3em; text-transform:uppercase;
               color:var(--gold); margin-bottom:2.2mm; padding-left:.3em }
.seal p { font:italic 500 12.4pt/1.5 'Cormorant Garamond',serif; margin-bottom:1.6mm }
.seal.multi { margin-top:0 }
.seal.multi p { font-size:11.6pt; line-height:1.42 }
.seal.multi .label + p + .label { margin-top:3.4mm }

/* page trop pleine : resserrée par FIT_JS, jamais rognée */
.inner.dense { top:23mm !important }
.dense p { margin-bottom:2.6mm }
.dense .decl p { line-height:1.46 }
.dense .seal.multi p { line-height:1.34 }
.dense .amen { margin-top:3mm }
.dense .glyph { height:11mm }
.dense .sep { margin:2mm auto 4.5mm }
.dense .stars { margin:0 0 3mm }
.dense .seal { margin:3.5mm 0 3.5mm }
.dense .seal.multi { margin-top:0 }
.dense .lead { margin-bottom:1.6mm }
.dense .decl { margin-bottom:3mm }

.decl { border-left:1.4pt solid var(--gold-l); padding-left:4.2mm; margin:1mm 0 4.2mm 1mm }
.decl p { font:500 12pt/1.55 'Cormorant Garamond',serif; margin-bottom:0 }

.amen { margin-top:5mm; text-align:center; font:italic 500 14pt 'Playfair Display',serif; color:var(--gold) }
.foot { position:absolute; left:0; right:0; bottom:-1mm; text-align:center; font:500 8.5pt 'Cormorant Garamond',serif;
        letter-spacing:.28em; color:var(--gold); text-transform:uppercase }
.foot b { font-weight:400; letter-spacing:0; margin-left:2mm }
"""

SVG = {
    # soleil levant : horizon, demi-disque, rayons
    "Matin": '<svg viewBox="0 0 60 30" fill="none" stroke="#1b2a4a" stroke-width="1.1" stroke-linecap="round">'
             '<path d="M8 27h44"/><path d="M19 27a11 11 0 0 1 22 0"/>'
             '<path d="M30 7v5M17 11l3 4M43 11l-3 4M9 20l4 1.5M51 20l-4 1.5"/></svg>',
    # soleil au zénith : disque et huit rayons
    "Midi": '<svg viewBox="0 0 40 40" fill="none" stroke="#1b2a4a" stroke-width="1.1" stroke-linecap="round">'
            '<circle cx="20" cy="20" r="7"/><path d="M20 3v6M20 31v6M3 20h6M31 20h6M8 8l4 4M28 28l4 4M32 8l-4 4M12 28l-4 4"/></svg>',
    # croissant de lune et étoile
    "Soir": '<svg viewBox="0 0 40 40" fill="none" stroke="#1b2a4a" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M27 6a15 15 0 1 0 8 25 12 12 0 0 1-8-25z"/><path d="M33 8v5M30.5 10.5h5"/></svg>',
}
SOLEIL_COUVERTURE = (
    '<svg viewBox="0 0 80 80" width="30mm" height="30mm" fill="none" stroke="#c9a45c" stroke-width="1.1" stroke-linecap="round">'
    '<circle cx="40" cy="40" r="12"/><circle cx="40" cy="40" r="19" stroke-dasharray=".3 2.4" stroke-width="1"/>'
    '<path d="M40 5v10M40 65v10M5 40h10M65 40h10M15 15l7 7M58 58l7 7M65 15l-7 7M22 58l-7 7"/></svg>'
)


# Les pages ont une hauteur fixe et overflow:hidden : un texte trop long serait rogné en
# silence, sans page en plus. Chaque page se mesure donc avant l'impression.
FIT_JS = """
document.fonts.ready.then(() => {
  const exces = (inner) => {
    const pied = inner.querySelector('.foot');
    const blocs = [...inner.children].filter((c) => c !== pied);
    return blocs.length ? blocs.at(-1).getBoundingClientRect().bottom - (pied.getBoundingClientRect().top - 6) : 0;
  };
  const debord = [];
  document.querySelectorAll('.page .inner').forEach((inner, i) => {
    if (exces(inner) <= 0) return;
    inner.classList.add('dense');
    const reste = exces(inner);
    if (reste > 0) debord.push(`${i + 2} (${Math.ceil(reste)} px de trop)`);
  });
  document.body.dataset.debord = debord.join(',');
  document.body.dataset.mesure = '1';
});
"""


def rendre_bloc(paras):
    out = []
    for p in paras:
        ligne0 = p[0].strip()
        if ligne0.startswith(("Je suis ", "Je ne peux pas perdre")):
            out.append(f'<div class="decl"><p>{lignes_vers_html(p)}</p></div>')
        elif ligne0 == "Je me lève et je décrète :":
            out.append(f'<p class="lead">{lignes_vers_html(p)}</p>')
        elif ligne0 == "Amen.":
            out.append(f'<div class="amen">Amen.</div>')
        else:
            out.append(f"<p>{lignes_vers_html(p)}</p>")
    return "\n".join(out)


def rendre_scripture(titre, lignes):
    """Bloc d'Écriture entre deux filets (le Sceau, le Psaume 23) ; la casse vient du CSS."""
    return (f'<div class="seal"><div class="label">{esc(titre)}</div>'
            f'<p>{lignes_vers_html(lignes)}</p></div>')


def rendre_scriptures(blocs):
    """Les sous-titres #### d'un office : un seul cadre, plus serré dès qu'il y en a plusieurs."""
    if len(blocs) == 1:
        return rendre_scripture(*blocs[0])
    corps = "".join(f'<div class="label">{esc(t)}</div><p>{lignes_vers_html(l)}</p>' for t, l in blocs)
    return f'<div class="seal multi">{corps}</div>'


def pied(num, nom, suite):
    return f'<div class="foot">{esc(num)} · {esc(nom)}{" — suite" if suite else ""} <b>✦</b></div>'


def cadre(extra=""):
    return ('<div class="f1"></div><div class="f2"></div>'
            '<div class="br tl"></div><div class="br tr"></div><div class="br bl"></div><div class="br brr"></div>' + extra)


def page_office_1(o, intro_paras, mots, sceau):
    np_, *reste = intro_paras
    np_html = f'<p class="np">{lignes_vers_html(np_)}</p>'
    # le séparateur ✦ ✦ ✦ du markdown est une ligne seule ; il est déjà retiré des paragraphes
    corps = "\n".join(f"<p>{lignes_vers_html(p)}</p>" for p in reste)
    return (f'<section class="page">{cadre()}<div class="inner">'
            f'<div class="glyph">{SVG[o["nom"]]}</div>'
            f'<h2>Invocation {esc(o["art"])} <em>{esc(o["nom"])}</em></h2>'
            f'<div class="heure">· {esc(o["heure"])} ·</div>'
            f'<div class="mots">{esc(mots)}</div>'
            f'<div class="sep"><i></i><b>◆</b><i></i></div>'
            f'{np_html}<div class="stars">✦ ✦ ✦</div>{corps}{sceau}'
            f'{pied(o["num"], o["nom"], False)}</div></section>')


def page_office_2(o, psaume, suite_html):
    return (f'<section class="page">{cadre()}<div class="inner" style="top:30mm">'
            f'{psaume}{suite_html}{pied(o["num"], o["nom"], True)}</div></section>')


def construire(livret):
    pages = []
    s = livret["sous_titre"].replace(" — ", " —<br>")
    pages.append(
        f'<section class="page cover">{cadre()}<div class="center">{SOLEIL_COUVERTURE}'
        f'<div class="kicker">Livret de prière</div>'
        f'<h1>Les Trois Prières<em>du Jour</em></h1><div class="rule"></div>'
        f'<div class="sub">{s}</div></div>'
        f'<div class="epi">{esc(livret["epigraphe"])}</div></section>')

    for o in livret["offices"]:
        intro = next(sec for sec in o["sections"] if sec[0] == "intro")[2]
        mots = ""
        corps_intro = []
        for l in intro:
            m = re.match(r"^\*\*(.+)\*\*$", l.strip())
            if m:
                mots = m.group(1)
            elif l.strip() == "✦ ✦ ✦":
                corps_intro.append("")       # sépare la prière commune de l'invocation
            else:
                corps_intro.append(l)
        paras = paragraphes(corps_intro)

        sceau = ""
        h4 = []
        suite = []
        for kind, titre, lignes in o["sections"]:
            if kind == "intro":
                continue
            if kind == "h3" and titre.startswith("Le Sceau"):
                sceau = rendre_scripture(titre, lignes)
            elif kind == "h4":
                h4.append((titre, lignes))
            else:
                suite.append(rendre_bloc(paragraphes(lignes)))   # intertitres du markdown : non repris
        pages.append(page_office_1(o, paras, mots, sceau))
        pages.append(page_office_2(o, rendre_scriptures(h4) if h4 else "", "\n".join(suite)))
    return pages


def main():
    out = DEFAULT_OUT
    keep = False
    for a in sys.argv[1:]:
        if a.startswith("--out="):
            out = Path(a.split("=", 1)[1]).resolve()
        elif a == "--keep-html":
            keep = True
    livret = lire_livret()
    pages = construire(livret)
    fonts = ("https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,500;1,600"
             "&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400;1,500;1,600"
             "&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=block")
    doc = (f'<!doctype html><html lang="fr"><head><meta charset="utf-8">'
           f'<title>Les Trois Prières du Jour</title><link rel="stylesheet" href="{fonts}">'
           f'<style>{CSS}</style></head><body>{"".join(pages)}<script>{FIT_JS}</script></body></html>')

    tmp = Path(tempfile.mkdtemp(prefix="livret-pdf-"))
    page_html = tmp / "livret.html"
    page_html.write_text(doc, encoding="utf-8")

    dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=20000",
                          "--dump-dom", page_html.as_uri()], check=True, capture_output=True, text=True).stdout
    mesure = re.search(r'<body[^>]*data-debord="([^"]*)"[^>]*data-mesure="1"', dom)
    if not mesure:
        raise SystemExit("⚠ la mesure des pages n'a pas abouti (polices non chargées ?)")
    if mesure.group(1):
        raise SystemExit(f"⚠ texte rogné même resserré, page(s) {mesure.group(1)} : alléger l'office")
    brut = tmp / "brut.pdf"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--virtual-time-budget=20000", f"--print-to-pdf={brut}", page_html.as_uri()],
                   check=True, capture_output=True)

    # métadonnées du PDF d'origine
    from pypdf import PdfReader, PdfWriter
    r = PdfReader(str(brut))
    w = PdfWriter()
    for p in r.pages:
        w.add_page(p)
    w.add_metadata({"/Title": "Les Trois Prières du Jour", "/Author": "Popaul Kabeya",
                    "/Subject": "Invocations matin, midi, soir — scellées par Éphésiens 3:20-21, Psaume 23"})
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as f:
        w.write(f)
    attendu = 1 + 2 * len(livret["offices"])
    print(f"{out} — {len(r.pages)} pages (attendu {attendu})")
    if len(r.pages) != attendu:
        print("⚠ une page déborde : réduire le corps de texte ou revoir le découpage", file=sys.stderr)
        sys.exit(2)
    if keep:
        print("HTML conservé :", page_html)


if __name__ == "__main__":
    main()
