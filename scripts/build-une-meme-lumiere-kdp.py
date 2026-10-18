#!/usr/bin/env python3
"""
build-une-meme-lumiere-kdp.py — Fabrique l'édition Amazon KDP d'« Une même lumière »
à partir du texte de la bibliothèque (Une-Meme-Lumiere-Cinq-Religions-FR.md), ou de son édition anglaise,
« The Same Light » (Une-Meme-Lumiere-Cinq-Religions-EN.md), avec l'option --lang=en.

Sort dans docs/edition-amazon/ (docs/edition-amazon/en/ pour l'anglais) l'intérieur du livre broché : PDF
5,5 × 8,5 pouces (13,97 × 21,59 cm), polices incorporées, marges KDP, pages gauche/droite, en-têtes et folios.

Le PDF est rendu par Chrome sans interface, en deux passes : la première donne les pages
où tombent les titres (signets du PDF), la seconde les inscrit dans la table des matières.
Les polices viennent de Google Fonts (réseau nécessaire à la fabrication seulement).

Usage : python3 scripts/build-une-meme-lumiere-kdp.py [--lang=en] [--keep-html]
Les deux autres scripts (couverture, EPUB) prennent la même option --lang=en.
"""
import html
import re
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

import fitz  # PyMuPDF
import markdown
from bs4 import BeautifulSoup, NavigableString

ROOT = Path(__file__).resolve().parent.parent
POLICES = ROOT / "docs" / "edition-amazon" / "polices"  # communes aux deux éditions
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
AUTEUR = "Popaul Kabeya"
ANNEE = "2026"
VS15 = ""  # pas de sélecteur de variante : la police des symboles est imposée, Chrome irait chercher un repli

# Ce qui change d'une édition à l'autre. « en_tetes » : en-tête des pages de droite, le nom court de la partie.
EDITIONS = {
    "fr": {
        "source": "Une-Meme-Lumiere-Cinq-Religions-FR.md", "dossier": "",
        "fichiers": {"pdf": "Une-Meme-Lumiere-interieur-5.5x8.5in.pdf", "epub": "Une-Meme-Lumiere.epub",
                     "jpg": "Une-Meme-Lumiere-couverture-ebook.jpg", "couverture": "Une-Meme-Lumiere-couverture-broche.pdf"},
        "titre": "Une même lumière", "titre_lignes": "Une même<br>lumière",
        "sous_titre": "Dieu, la mort, le pardon, la prospérité et la puissance — ce que répondent les Écritures des cinq religions",
        "sous_titre_lignes": "Dieu, la mort, le pardon, la prospérité et la puissance —<br>ce que répondent les Écritures des cinq religions",
        "titre_courant": "UNE MÊME LUMIÈRE", "table": "Table des matières",
        "dedicace": "À ceux qui perdent leur vie dans les guerres, les épidémies et la misère, et qui gardent pourtant la lumière.",
        "symboles": {"Hindouisme": "ॐ", "Judaïsme": "✡", "Bouddhisme": "☸", "Christianisme": "✝", "Islam": "☪"},
        "mot_partie": "partie", "annexes": "Annexes", "sans_chapitres": ("Première partie", "Septième partie"),
        "en_tetes": {"Pourquoi ce livre": "Pourquoi ce livre", "Avant-propos": "Avant-propos", "Première partie": "Les cinq traditions", "Deuxième partie":
                     "Le Principe", "Troisième partie": "Autrui", "Quatrième partie": "La conduite", "Cinquième partie":
                     "La vie intérieure", "Sixième partie": "La destinée", "Septième partie": "Ce qui les distingue",
                     "Conclusion": "Conclusion", "Annexes": "Annexes"},
        "copyright": """<p>© {auteur}, {annee}. Tous droits réservés.</p>
  <p>Le texte, les synthèses, l'appareil de notes et les traductions de travail de ce livre sont l'œuvre de
  l'auteur. Aucune partie de ce livre ne peut être reproduite, stockée ou diffusée, sous quelque forme que ce soit,
  sans l'autorisation écrite de l'auteur, sauf de courtes citations faites dans le cadre d'une critique ou d'une étude.</p>
  <p>Les traductions anciennes citées — Bible du Rabbinat français, Louis Segond, Kazimirski, Burnouf, Hû, Langlois,
  Loiseleur-Deslongchamps, Schwab — appartiennent au domaine public.</p>
  <p>Première édition, {annee}.</p>""",
        "note": """<h2>Note sur les textes cités</h2>
  <p>Chaque citation a été relue dans sa source avant d'entrer dans ce livre. Les traductions employées sont anciennes
  et du domaine public : la Bible du Rabbinat français pour la Bible hébraïque, Louis Segond (1910) pour le Nouveau
  Testament, Kazimirski (1869) pour le Coran, Émile Burnouf (1861) pour la Bhagavad-Gîtâ, Fernand Hû (1878) pour le
  Dhammapada. Leur français a parfois un siècle et demi&#8239;; il est cité tel quel.</p>
  <p>Lorsqu'aucune traduction française libre de droits n'existait (certains hadiths, Upanishads, textes du canon pali),
  le passage a été traduit pour ce livre d'après l'original ou une traduction ancienne, et la référence le signale par
  la mention «&#8239;trad. de travail&#8239;». La liste complète des sources figure en fin de volume.</p>
  <p class="epi">Rapprocher n'est pas confondre&#8239;: chaque tradition est présentée<br>dans ses propres mots,
  sans être ramenée à une autre.</p>""",
    },
    "en": {
        "source": "Une-Meme-Lumiere-Cinq-Religions-EN.md", "dossier": "en",
        "fichiers": {"pdf": "The-Same-Light-interior-5.5x8.5in.pdf", "epub": "The-Same-Light.epub",
                     "jpg": "The-Same-Light-cover-ebook.jpg", "couverture": "The-Same-Light-cover-paperback.pdf"},
        "titre": "The Same Light", "titre_lignes": "The Same<br>Light",
        "sous_titre": "God, Death, Forgiveness, Prosperity and Power — How the Scriptures of Five Religions Answer",
        "sous_titre_lignes": "God, Death, Forgiveness, Prosperity and Power —<br>How the Scriptures of Five Religions Answer",
        "titre_courant": "THE SAME LIGHT", "table": "Contents",
        "dedicace": "To those who lose their lives to war, epidemic and poverty, and who still keep the light.",
        "symboles": {"Hinduism": "ॐ", "Judaism": "✡", "Buddhism": "☸", "Christianity": "✝", "Islam": "☪"},
        "mot_partie": "Part", "annexes": "Appendices", "sans_chapitres": ("Part One", "Part Seven"),
        "en_tetes": {"Why This Book": "Why This Book", "Foreword": "Foreword", "Part One": "The Five Traditions", "Part Two": "The Principle",
                     "Part Three": "The Other", "Part Four": "Conduct", "Part Five": "The Inner Life",
                     "Part Six": "Destiny", "Part Seven": "What Sets Them Apart", "Conclusion": "Conclusion",
                     "Appendices": "Appendices"},
        "copyright": """<p>© {auteur}, {annee}. All rights reserved.</p>
  <p>The text, the summaries, the notes, the working translations and the English renderings of the passages quoted
  in this book are the work of the author. No part of this book may be reproduced, stored or transmitted in any form
  without the written permission of the author, except for brief quotations in a review or a study.</p>
  <p>The older translations and editions quoted (the French Rabbinate Bible, Louis Segond, Kazimirski, Burnouf, Hû, Langlois,
  Loiseleur-Deslongchamps, Schwab, La Vallée Poussin, Maillard, Saint-Martin, Barbier de Meynard, Julien, Johnson, Tagore,
  Morfill, Warren, Underhill) and the World English Bible are in the public domain.</p>
  <p>First English edition, {annee}. Also available in French: <em>Une même lumière</em>.</p>""",
        "note": """<h2>A Note on the Texts Quoted</h2>
  <p>Every quotation was reread in its source before entering this book. The book was first written in French, and it
  quotes old translations in the public domain: the French Rabbinate Bible for the Hebrew Bible, Louis Segond (1910)
  for the New Testament, Kazimirski (1869) for the Qur’an, Émile Burnouf (1861) for the Bhagavad-Gita, Fernand Hû
  (1878) for the Dhammapada. In this edition they are rendered into English as closely as possible, and each
  reference names the translation followed, with the word “after”; texts whose old translation is in English (Tagore’s Kabir, <em>The Cloud of Unknowing</em>) are quoted as printed.</p>
  <p>Where no free translation existed (certain hadiths, Upanishads, texts of the Pali canon), the passage was
  translated for this book from the original or from an old translation, and the reference marks it with the words
  “working translation.” The full list of sources appears at the end of the volume.</p>
  <p class="epi">To bring together is not to confuse: each tradition is presented<br>in its own words,
  without being reduced to another.</p>""",
    },
}


def langue_demandee():
    """--lang=en (ou --lang en) choisit l'édition anglaise ; sans option, l'édition française."""
    m = re.search(r"--lang[= ](\S+)", " ".join(sys.argv[1:]))
    return m.group(1) if m else "fr"


LANGUE = langue_demandee()
if LANGUE not in EDITIONS:
    sys.exit(f"Langue inconnue : {LANGUE} (choix : {', '.join(EDITIONS)})")
E = EDITIONS[LANGUE]
SRC, OUT = ROOT / E["source"], ROOT / "docs" / "edition-amazon" / E["dossier"]
PDF_OUT, EPUB_OUT, COVER_JPG = (OUT / E["fichiers"][k] for k in ("pdf", "epub", "jpg"))
TITRE, SOUS_TITRE, SYMBOLES, EN_TETES = E["titre"], E["sous_titre"], E["symboles"], E["en_tetes"]

# API historique de Google Fonts : elle sert des TTF statiques, une par graisse. Les polices variables
# de l'API css2 sortent de Chrome en Type 3, mal rendues à l'impression et parfois refusées par KDP.
FONTS = ("https://fonts.googleapis.com/css?family=EB+Garamond:400,400i,500,500i,600"
         "|Cormorant+Garamond:500,500i,600&subset=latin,latin-ext")
SYMBOL_FONTS = ("https://fonts.googleapis.com/css?family=Noto+Sans+Symbols|Noto+Sans+Symbols+2|Noto+Serif+Devanagari:500"
                "&text=" + urllib.parse.quote("".join(SYMBOLES.values()) + "✦"))


def telecharger(url):
    """curl plutôt qu'urllib : le Python de python.org sur macOS n'a pas toujours ses certificats."""
    return subprocess.run(["curl", "-sfL", url], check=True, capture_output=True).stdout


def css_polices():
    """Télécharge une fois les polices Google (licence OFL) dans docs/edition-amazon/polices
    et renvoie leurs @font-face en chemins locaux : Chrome sans interface ne les charge pas toujours en ligne."""
    dossier = POLICES
    dossier.mkdir(parents=True, exist_ok=True)
    cache = dossier / "polices.css"
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    morceaux = []
    for url in (FONTS, SYMBOL_FONTS):
        css = telecharger(url).decode("utf-8")

        def local(m):
            src = m.group(1)
            nom = re.sub(r"[^A-Za-z0-9._-]", "_", src.split("/s/", 1)[-1])[-90:].lstrip("_")
            cible = dossier / nom
            if not cible.exists():
                cible.write_bytes(telecharger(src))
            return f"url({cible.as_uri()})"
        morceaux.append(re.sub(r"url\((https://[^)]+)\)", local, css))
    texte = "\n".join(morceaux)
    cache.write_text(texte, encoding="utf-8")
    return texte


# ─────────────────────────── texte → HTML ───────────────────────────

def lire_html():
    md = SRC.read_text(encoding="utf-8")
    # Les <p class="ref"> sont du HTML brut : Markdown n'y traite pas l'italique.
    md = re.sub(r'(?m)^(<p class="[^"]+">.*)$',
                lambda m: re.sub(r"\*([^*]+)\*", r"<em>\1</em>", m.group(1)), md)
    corps = markdown.markdown(md, extensions=["tables", "md_in_html"])
    return BeautifulSoup(corps, "html.parser")


def typographie(soup):
    """Français : espaces insécables, ni « : ; ! ? » ni les guillemets seuls en début de ligne.
    Anglais : apostrophes courbes (‘ en début de mot, ’ ailleurs) et tiret long lié au mot qui le précède."""
    for noeud in list(soup.find_all(string=True)):
        if not isinstance(noeud, NavigableString) or noeud.parent.name in ("style", "script"):
            continue
        t = str(noeud)
        if LANGUE == "fr":
            t = re.sub(r" ([;!?»])", " \\1", t)
            t = re.sub(r" :", " :", t)
            t = re.sub(r"« ", "« ", t)
            t = re.sub(r" —", " —", t)
        else:
            avant = noeud.find_previous(string=True)
            if t.startswith("'") and (avant is None or not str(avant) or str(avant)[-1] in " \n([—“"):
                t = "‘" + t[1:]
            t = re.sub(r"(?<=[\s(\[—“])'", "‘", t).replace("'", "’")
            t = re.sub(r" —", "\u00a0—", t)
        if t != str(noeud):
            noeud.replace_with(t)


def decouper(soup):
    """Regroupe le texte en sections, une par titre de niveau 1 (partie, avant-propos, conclusion…)."""
    sections, cur = [], None
    for el in list(soup.children):
        if getattr(el, "name", None) == "h1":
            texte = el.get_text()
            if re.search(r"\s—\s", texte):
                kicker, titre = re.split(r"\s—\s", texte, maxsplit=1)
            else:
                kicker, titre = "", texte
            cur = {"kicker": kicker, "titre": titre, "brut": texte, "contenu": []}
            sections.append(cur)
        elif cur is not None and not (isinstance(el, NavigableString) and not el.strip()):
            cur["contenu"].append(el)
    for s in sections:
        cle = s["kicker"] or s["titre"]
        s["entete"] = EN_TETES[cle]
        s["est_partie"] = E["mot_partie"] in s["kicker"] or s["titre"] == E["annexes"]
    return sections


def orner(contenu):
    """Symbole de chaque tradition devant son nom ; chapitres numérotés repérés pour le saut de page."""
    for el in contenu:
        if not hasattr(el, "find_all"):
            continue
        for h in ([el] if el.name in ("h2", "h3") else []) + el.find_all(["h2", "h3"]):
            nom = h.get_text().strip()
            if h.name == "h3" and nom in SYMBOLES:
                h["class"] = "tradition"
                h.insert(0, NavigableString(" "))
                h.insert(0, BeautifulSoup(f'<span class="sym">{SYMBOLES[nom]}{VS15}</span>', "html.parser").span)
            if h.name == "h2" and re.match(r"\d+\. ", nom):
                h["class"] = "chapitre"
                num, reste = nom.split(". ", 1)
                h.clear()
                for span in BeautifulSoup(f'<span class="num">{num}</span><span class="t">{html.escape(reste)}</span>',
                                          "html.parser").find_all("span"):
                    h.append(span.extract())


def contenu_html(contenu):
    return "\n".join(str(el) for el in contenu)


# ─────────────────────────── livre broché (PDF) ───────────────────────────

CSS_PRINT = """
@page { size: 5.5in 8.5in; margin: 0.72in 0.55in 0.78in 0.55in; }
@page :right { margin-left: 0.75in; margin-right: 0.55in;
  @bottom-right { content: counter(page); font: 10pt 'EB Garamond', serif; color: #333; } }
@page :left { margin-left: 0.55in; margin-right: 0.75in;
  @top-left { content: "%(titre_courant)s"; font: 7.5pt 'EB Garamond', serif; letter-spacing: 0.18em; color: #555; }
  @bottom-left { content: counter(page); font: 10pt 'EB Garamond', serif; color: #333; } }
@page :blank { @top-left { content: none } @top-right { content: none }
  @bottom-left { content: none } @bottom-right { content: none } }
@page front { @top-left { content: none } @top-right { content: none }
  @bottom-left { content: none } @bottom-right { content: none } }
@page ouverture { @top-left { content: none } @top-right { content: none }
  @bottom-left { content: none } @bottom-right { content: none } }
%(pages_nommees)s
html { font-family: 'EB Garamond', Garamond, serif; font-size: 10.6pt; line-height: 1.41; color: #111; }
body { margin: 0; }
p { margin: 0; text-align: justify; hyphens: auto; orphans: 2; widows: 2; }
p + p { text-indent: 1.2em; }
.sym, .orn { font-family: 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Serif Devanagari', serif; font-weight: 400; }
em { font-style: italic; }
strong { font-weight: 600; }
sup { font-size: 0.68em; line-height: 0; }

.front { page: front; }
.front section { break-after: page; height: 6.96in; box-sizing: border-box; position: relative; overflow: hidden; }
.faux-titre { text-align: center; padding-top: 2in; font-family: 'Cormorant Garamond', serif;
  font-size: 20pt; letter-spacing: 0.08em; }
.titre { text-align: center; padding-top: 1in; }
.titre .t { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 30pt;
  letter-spacing: 0.1em; line-height: 1.15; text-transform: uppercase; }
.titre .orn { margin: 18pt 0; font-size: 11pt; letter-spacing: 0.6em; color: #8a6d2b; }
.titre .st { font-style: italic; font-size: 13pt; line-height: 1.35; margin: 0 0.3in; text-align: center; }
.titre .aut { margin-top: 42pt; font-size: 12.5pt; letter-spacing: 0.22em; text-transform: uppercase; text-align: center; }
.titre .syms { position: absolute; bottom: 0.1in; left: 0; right: 0; text-align: center;
  font-size: 13pt; letter-spacing: 0.9em; color: #444; }
.copyright { position: absolute; bottom: 0; font-size: 8.4pt; line-height: 1.45; }
.copyright p { text-align: left; text-indent: 0; margin-bottom: 7pt; hyphens: manual; }
.dedicace { padding-top: 2.3in; }
.dedicace p { font-style: italic; text-align: center; text-indent: 0; margin: 0 0.45in; text-wrap: balance; }
.note { padding-top: 1.1in; }
.note h2 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 15pt; text-align: center;
  margin: 0 0 18pt; letter-spacing: 0.06em; }
.note p { text-indent: 0; margin-bottom: 9pt; }
.note .epi { font-style: italic; text-align: center; margin-top: 26pt; }

.toc h2 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 16pt; text-align: center;
  margin: 0.05in 0 12pt; letter-spacing: 0.06em; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { display: flex; align-items: baseline; font-size: 9.4pt; line-height: 1.22; margin: 0 0 1.6pt; }
.toc li .l { flex: 1; border-bottom: 1px dotted #999; margin: 0 4pt; transform: translateY(-3pt); }
.toc li.n1 { margin-top: 6pt; font-variant: small-caps; letter-spacing: 0.04em; font-weight: 500; }
.toc li.n2 { padding-left: 1.1em; }

section.part { break-before: page; }
.blanc { page: ouverture; height: 1pt; }
.ouverture { page: ouverture; break-after: page; text-align: center; padding-top: 1.5in; }
.ouverture .k { font-variant: small-caps; letter-spacing: 0.2em; font-size: 11pt; color: #555; }
.ouverture h1 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 24pt; line-height: 1.2;
  margin: 10pt 0 22pt; letter-spacing: 0.02em; }
.ouverture .orn { font-size: 10pt; letter-spacing: 0.6em; color: #8a6d2b; margin-bottom: 26pt; }
.ouverture p.part-intro { font-style: italic; text-align: center; hyphens: manual; margin: 0 0.2in; text-indent: 0; }
h1.simple { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 21pt; text-align: center;
  margin: 0.45in 0 20pt; }
.simple-intro { font-style: italic; text-align: center; margin: 0 0.25in 18pt; text-indent: 0 !important; }

h2 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 14.5pt; line-height: 1.25;
  margin: 18pt 0 8pt; break-after: avoid; }
h2.chapitre { break-before: page; text-align: center; margin: 0.12in 0 12pt; font-size: 17pt; }
h2.chapitre .num { display: block; font-variant-numeric: lining-nums; font-size: 28pt; color: #8a6d2b; font-weight: 500; line-height: 1; margin-bottom: 6pt; }
h2.chapitre + p { text-indent: 0; }
h3 { font-size: 11pt; font-weight: 600; font-variant: small-caps; letter-spacing: 0.08em;
  margin: 15pt 0 6pt; break-after: avoid; }
h3.tradition .sym { font-size: 10pt; color: #8a6d2b; margin-right: 3pt; }
h3 + p, h2 + p, .synthese h4 + p { text-indent: 0; }
h1, h2, .ouverture h1, .ouverture p.part-intro, .titre .st { text-wrap: balance; }

blockquote { margin: 6pt 0 0 0.22in; padding: 0; font-size: 9.9pt; line-height: 1.38; }
blockquote p { text-indent: 0 !important; margin-bottom: 3pt; }
p.ref { font-size: 8.3pt; text-align: right; color: #444; margin: 2pt 0 8pt; text-indent: 0 !important;
  break-before: avoid; hyphens: manual; }
p.ref + p { text-indent: 0; }
span.sc { font-variant: small-caps; letter-spacing: 0.04em; }

.synthese { margin: 12pt 0 5pt; padding: 7pt 0 3pt; border-top: 0.8pt solid #8a6d2b; border-bottom: 0.8pt solid #8a6d2b; }
.synthese h4 { font-size: 9.5pt; font-weight: 600; font-variant: small-caps; letter-spacing: 0.12em;
  margin: 4pt 0 4pt; color: #6b5420; break-after: avoid; }
.synthese p { font-size: 10pt; margin-bottom: 4pt; }

table { width: 100%; border-collapse: collapse; margin: 6pt 0 8pt; font-size: 7.6pt; line-height: 1.25;
  break-inside: avoid; }
th { font-weight: 600; text-align: left; border-bottom: 0.8pt solid #333; padding: 2pt 3pt; vertical-align: bottom; }
td { border-bottom: 0.4pt solid #bbb; padding: 2pt 3pt; vertical-align: top; text-align: left; hyphens: manual; }
table + p { break-before: avoid; text-indent: 0 !important; }
.chap.serre { line-height: 1.36; } .chap.serre blockquote { line-height: 1.32; } .chap.serre p.ref { margin-bottom: 6pt; }
ul { margin: 4pt 0 8pt 0; padding-left: 1.1em; }
li { margin-bottom: 3pt; text-align: justify; hyphens: auto; }
.annexes li { font-size: 9pt; }
.annexes p.part-intro { font-style: italic; text-indent: 0; margin-bottom: 8pt; }
"""


def pages_nommees(sections):
    regles = []
    for i, s in enumerate(sections):
        regles.append(f'@page s{i}:right {{ @top-right {{ content: "{s["entete"].upper()}"; '
                      "font: 7.5pt 'EB Garamond', serif; letter-spacing: 0.18em; color: #555; } }")
    return "\n".join(regles)


def front_matter(toc_items):
    syms = " ".join(v + VS15 for v in SYMBOLES.values())
    toc = "\n".join(f'<li class="n{n}"><span>{html.escape(t)}</span><span class="l"></span><span>{p}</span></li>'
                    for n, t, p in toc_items)
    return f"""
<div class="front">
<section><div class="faux-titre">{TITRE}</div></section>
<section></section>
<section class="titre">
  <div class="t">{E["titre_lignes"]}</div>
  <div class="orn">✦ ✦ ✦</div>
  <p class="st">{E["sous_titre_lignes"]}</p>
  <p class="aut">{AUTEUR}</p>
  <div class="syms"><span class="sym">{syms}</span></div>
</section>
<section><div class="copyright">
  <p><em>{TITRE}</em><br>{SOUS_TITRE}</p>
  {E["copyright"].format(auteur=AUTEUR, annee=ANNEE)}
</div></section>
<section class="dedicace"><p>{E["dedicace"]}</p></section>
<section class="note">
  {E["note"]}
</section>
<section class="toc"><h2>{E["table"]}</h2><ol>{toc}</ol></section>
</div>"""


def corps_pdf(sections, blancs=(), serres=()):
    morceaux = []
    for i, s in enumerate(sections):
        if i in blancs:  # page blanche : Chrome n'honore pas « break-before: right », la partie doit ouvrir sur une belle page
            morceaux.append('<div class="blanc"></div>')
        contenu = s["contenu"]
        intro = ""
        if contenu and getattr(contenu[0], "get", lambda k: None)("class") == ["part-intro"]:
            intro, contenu = str(contenu[0]), contenu[1:]
        corps = contenu_html(contenu)
        # chaque chapitre numéroté dans son bloc, pour pouvoir le resserrer seul
        corps = re.sub(r'(<h2 class="chapitre"><span class="num">(\d+)</span>)',
                       lambda m: f'</div><div class="chap{" serre" if int(m.group(2)) in serres else ""}">{m.group(1)}', corps)
        corps = re.sub(r'^<div class="chap">\s*</div>', "", f'<div class="chap">{corps}</div>')  # pas de bloc vide : il prendrait une page
        if s["est_partie"]:
            entete = (f'<div class="ouverture"><div class="k">{html.escape(s["kicker"])}</div>'
                      f'<h1>{html.escape(s["titre"])}</h1><div class="orn">✦ ✦ ✦</div>{intro}</div>')
        else:
            intro = intro.replace('class="part-intro"', 'class="simple-intro"')
            entete = f'<h1 class="simple">{html.escape(s["brut"])}</h1>{intro}'
        classe = "part annexes" if s["titre"] == E["annexes"] else "part"
        if s["est_partie"]:
            morceaux.append(f'<section class="{classe}">{entete}<div style="page: s{i}">{corps}</div></section>')
        else:  # le titre reste sur la même page nommée que le texte, sinon Chrome les sépare
            morceaux.append(f'<section class="{classe}"><div style="page: s{i}">{entete}{corps}</div></section>')
    return "\n".join(morceaux)


def entrees_toc(sections):
    """Ce que liste la table : les parties et les chapitres, avec la clé qui retrouve leur page."""
    items = []
    for s in sections:
        items.append((1, s["brut"], s["titre"]))
        if E["mot_partie"] in s["kicker"] and s["kicker"] not in E["sans_chapitres"]:
            for el in s["contenu"]:
                if getattr(el, "name", None) == "h2":
                    items.append((2, el.get_text(" ", strip=True).replace(" ", ". ", 1)
                                  if el.find("span", class_="num") else el.get_text(), el.get_text("", strip=True)))
    return items


def page_html(sections, toc_pages, blancs=(), serres=()):
    items = entrees_toc(sections)
    toc_items = [(n, t, toc_pages.get(i, "000")) for i, (n, t, _) in enumerate(items)]
    css = CSS_PRINT.replace("%(pages_nommees)s", pages_nommees(sections)).replace("%(titre_courant)s", E["titre_courant"])
    return f"""<!doctype html><html lang="{LANGUE}"><head><meta charset="utf-8">
<style>{css_polices()}\n{css}</style></head><body>{front_matter(toc_items)}{corps_pdf(sections, blancs, serres)}</body></html>"""


def rendre_pdf(html_path, pdf_path):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--generate-pdf-document-outline", "--virtual-time-budget=30000",
                    f"--print-to-pdf={pdf_path}", html_path.as_uri()],
                   check=True, capture_output=True)


def pages_des_titres(pdf_path, sections):
    """Retrouve la page de chaque entrée de la table grâce aux signets que Chrome tire des titres."""
    outline = [(re.sub(r"\s+", "", t), p) for _, t, p in fitz.open(pdf_path).get_toc()]
    pages, debut = {}, 0
    for i, (_, _, cle) in enumerate(entrees_toc(sections)):
        cle = re.sub(r"\s+", "", cle)
        for j in range(debut, len(outline)):
            if outline[j][0].endswith(cle) or outline[j][0] == cle:
                pages[i], debut = outline[j][1], j + 1
                break
        else:
            sys.exit(f"Titre introuvable dans les signets : {cle}")
    return pages


def construire_pdf(sections, keep_html):
    tmp = Path(tempfile.mkdtemp(prefix="uml-kdp-"))
    page = tmp / "livre.html"
    pages, blancs, serres = {}, set(), set()
    items = entrees_toc(sections)
    niveaux = [n for n, _, _ in items]
    for passe in range(7):
        page.write_text(page_html(sections, pages, blancs, serres), encoding="utf-8")
        rendre_pdf(page, PDF_OUT)
        nouvelles = pages_des_titres(PDF_OUT, sections)
        # Chapitre dont la dernière page ne porterait qu'une à trois lignes : on le resserre légèrement.
        doc = fitz.open(PDF_OUT)
        avant = len(serres)
        for k, (n, t, _) in enumerate(items):
            m = re.match(r"(\d+)\. ", t)
            if n != 2 or not m or k + 1 >= len(items):
                continue
            fin = next(p for p in range(nouvelles[k + 1] - 1, nouvelles[k] - 1, -1)
                       if doc[p - 1].get_text().strip())
            lignes = len([l for l in doc[fin - 1].get_text().split("\n") if l.strip()]) - 2  # en-tête et folio
            if fin > nouvelles[k] and 0 < lignes <= 3:
                serres.add(int(m.group(1)))
        debuts = [p for p, n in zip([nouvelles[i] for i in range(len(niveaux))], niveaux) if n == 1]
        # Page où chaque section tomberait sans pages blanches, puis blanches là où elle tomberait à gauche.
        bruts = [p - sum(1 for b in blancs if b <= k) for k, p in enumerate(debuts)]
        voulues, decalage = set(), 0
        for k, p in enumerate(bruts):
            if (p + decalage) % 2 == 0:
                voulues.add(k)
                decalage += 1
        if nouvelles == pages and voulues == blancs and len(serres) == avant:
            break
        pages, blancs = nouvelles, voulues
    gauches = [p for p in debuts if p % 2 == 0]
    if gauches:
        print(f"⚠ section(s) ouvrant sur une page de gauche : {gauches}", file=sys.stderr)
    if keep_html:
        print("HTML :", page)
    return fitz.open(PDF_OUT)


# ─────────────────────────── main ───────────────────────────

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    soup = lire_html()
    typographie(soup)
    sections = decouper(soup)
    for s in sections:
        orner(s["contenu"])
    doc = construire_pdf(sections, "--keep-html" in sys.argv)
    w, h = doc[0].rect.width / 72, doc[0].rect.height / 72
    non_incorporees = {f[3] for p in doc for f in p.get_fonts() if f[1] == "n/a"}
    print(f"PDF : {PDF_OUT.relative_to(ROOT)} — {doc.page_count} pages, {w:.2f} × {h:.2f} in, "
          f"polices non incorporées : {sorted(non_incorporees) or 'aucune'}")


if __name__ == "__main__":
    main()
