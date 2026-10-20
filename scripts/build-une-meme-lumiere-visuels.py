#!/usr/bin/env python3
"""
build-une-meme-lumiere-visuels.py — Visuels de lancement d'« Une même lumière » pour les réseaux sociaux.

Pour chacun des 18 thèmes, un visuel « Cinq voix, une même lumière » (1080 × 1350 px, format 4:5 d'Instagram,
Facebook et WhatsApp) : une citation courte par tradition, tirée du manuscrit avec sa référence. Plus un visuel
d'annonce de parution. Le dessin reprend celui de la couverture (bleu nuit, or, symboles des cinq traditions).

Les citations sont choisies ci-dessous (CHOIX) par leur rang dans la section de la tradition ; un extrait se
marque « […] » comme dans le livre. Le script vérifie que les éditions française et anglaise citent la même
source au même rang.

Usage : python3 scripts/build-une-meme-lumiere-visuels.py [--lang=en]
        → docs/edition-amazon/kit-lancement/visuels/{fr,en}/
"""
import html
import importlib.util
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("kdp", ROOT / "scripts" / "build-une-meme-lumiere-kdp.py")
kdp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kdp)

LANGUE = kdp.LANGUE
SORTIE = ROOT / "docs" / "edition-amazon" / "kit-lancement" / "visuels" / LANGUE
TRADITIONS = list(kdp.SYMBOLES)  # dans l'ordre chronologique du livre

T = {
    "fr": {"serie": "Cinq voix · une même lumière", "formats": "E-book · broché",
           "titres": ["L'Ultime", "La lumière", "La Règle d'or", "La compassion", "La paix", "Le pardon", "Le don",
                      "Honorer père et mère", "La vérité", "L'honnêteté", "La maîtrise de soi", "L'humilité",
                      "La prière", "Le cœur", "Le détachement", "Les actes et leurs fruits", "La mort",
                      "Les mystiques"],
           "annonce": ("Enfin disponible", "Dix-huit questions posées aux Écritures de l'hindouisme, du judaïsme, "
                       "du bouddhisme, du christianisme et de l'islam — et leurs réponses, citées dans le texte.",
                       "E-book (PDF, EPUB) et livre broché",
                       "Apple Books · Kobo · Fnac · Barnes & Noble · Amazon<br>et en Afrique par Mobile Money")},
    "en": {"serie": "Five voices · the same light", "formats": "E-book · paperback",
           "titres": ["The Ultimate", "Light", "The Golden Rule", "Compassion", "Peace", "Forgiveness", "Giving",
                      "Honoring Father and Mother", "Truth", "Honesty", "Self-Mastery", "Humility", "Prayer",
                      "The Heart", "Detachment", "Deeds and Their Fruits", "Death", "The Mystics"],
           "annonce": ("Now available", "Eighteen questions put to the Scriptures of Hinduism, Judaism, Buddhism, "
                       "Christianity and Islam — and their answers, quoted in their own words.",
                       "E-book (PDF, EPUB) and paperback",
                       "Apple Books · Kobo · Barnes & Noble · Amazon<br>and in Africa by Mobile Money")},
}[LANGUE]

# Par thème, pour chaque tradition (hindouisme, judaïsme, bouddhisme, christianisme, islam) : le rang de la
# citation dans sa section, et au besoin l'extrait {"fr": (début, fin), "en": (début, fin)}.
X = lambda fr, en: {"fr": fr, "en": en}  # noqa: E731
CHOIX = [
    [0, 0, 1, 1, 2],
    [1, 1, (0, X(("C'est pourquoi", "refuge extérieur."), ("Therefore", "outside refuge."))), 1,
     (0, X(("Dieu est la", "de la terre."), ("God is the", "of the earth.")))],
    [(0, X(("Qu'on ne fasse", "nuisible à soi-même."), ("Let one never", "harmful to oneself."))),
     (2, X(("Hillel le convertit", "le commentaire »"), ("Hillel converted him", "its commentary”"))),
     (1, X(("puisque c'est", "toi-même."), ("since it is", "yourself."))), 0, 0],
    [(1, X(("Et celui qui", "détourne jamais."), ("And he who", "turns away from it."))), 1, 1, 1, 2],
    [2, (1, X(("celui qui sauve", "un monde entier"), ("he who saves", "a whole world"))), 1, 0, 2],
    [(0, X(("Le pardon est la force", "paix de l'esprit."), ("Forgiveness is the strength", "peace of mind."))), 0,
     (0, X(("« Ce qui fait cesser", "absence de haine. »"), ("“What makes hatreds", "absence of hatred.”"))), 2, 2],
    [0, 2, 0, 2, 1],
    [1, 0, 2, (0, X(("Honore ton père", "sur la terre."), ("Honor your father", "on the earth."))), 1],
    [(0, X(("Le vrai triomphe", "la voie des dieux"), ("Truth triumphs", "the way of the gods"))), 0, 1, 0, 1],
    [1, 0, (0, X(("Que le disciple", "pas été donné"), ("Let the disciple", "not been given to him"))), 0, 1],
    [1, 2, 0, 2, 2],
    [2, 0, (2, X(("Facile à voir", "sienne propre."), ("Easy to see", "one’s own."))), 1, 0],
    [1, 1, 1, 2, 2],
    [2, (0, X(("Ce que voit", "regarde le cœur."), ("What man sees", "at the heart."))), 1, 0, 1],
    [(0, X(("Sois attentif", "à leurs fruits"), ("Be attentive", "to their fruits"))), 1,
     (1, X(("la décrépitude", "avec diligence !"), ("decay is inherent", "with diligence!"))), 2, 2],
    [(0, X(("Tel on agit", "devient mauvais."), ("As one acts", "becomes evil."))), 1,
     (1, X(("On souffrira", "purifiera soi-même."), ("One will suffer", "purifies oneself."))),
     (0, X(("Ce qu'un homme", "moissonnera aussi."), ("What a man", "also reap."))), 0],
    [0, 0, 1, 2, 1],
    [(0, X(("Ô serviteur", "dans la mosquée"), ("O servant", "nor in mosque"))),
     (0, X(("« Et maintenant", "dans les nuées. »"), ("“And now", "in the clouds.”"))), 0,
     (0, X(("il peut bien être aimé", "pensée, jamais."), ("He may well be loved", "by thought never."))),
     (0, X(("Je dus ma guérison", "dans mon cœur"), ("I owed my cure", "my heart")))],
]


def citations(langue):
    """{(thème, tradition): [(texte, source), …]} tirés du manuscrit, dans l'ordre du livre."""
    noms = list(kdp.EDITIONS[langue]["symboles"])
    lignes = (ROOT / kdp.EDITIONS[langue]["source"]).read_text(encoding="utf-8").splitlines()
    out, theme, trad, bloc = {}, None, None, []
    for ligne in lignes:
        if m := re.match(r"^## (\d+)\. ", ligne):
            theme, trad, bloc = int(m.group(1)), None, []
        elif ligne.startswith("# ") or ligne.startswith("#### "):
            trad, bloc = None, []
        elif m := re.match(r"^### (.+)$", ligne):
            trad = m.group(1).strip() if theme and m.group(1).strip() in noms else None
            bloc = []
        elif trad and ligne.startswith(">"):
            bloc.append(ligne[1:].strip())
        elif trad and (m := re.match(r'^<p class="ref">— (.+?)</p>', ligne)) and bloc:
            texte = re.sub(r"\s+", " ", " ".join(x for x in bloc if x)).strip()
            out.setdefault((theme, noms.index(trad)), []).append((texte, m.group(1).split(" · ")[0].strip()))
            bloc = []
        elif ligne.strip() and not ligne.startswith("<p"):
            bloc = []
    return out


def extrait(texte, debut, fin):
    i = texte.index(debut)
    j = texte.index(fin, i) + len(fin)
    return ("[…] " if i else "") + texte[i:j] + (" […]" if j < len(texte) else "")


def chiffres(source):
    return re.sub(r"\D", "", re.sub(r"\[.*?\]", "", source))


def selection():
    ici, autre = citations(LANGUE), citations("en" if LANGUE == "fr" else "fr")
    themes = []
    for n, choix in enumerate(CHOIX, start=1):
        cinq = []
        for t, c in enumerate(choix):
            rang, coupe = c if isinstance(c, tuple) else (c, None)
            texte, source = ici[(n, t)][rang]
            if chiffres(source) != chiffres(autre[(n, t)][rang][1]):
                raise SystemExit(f"Thème {n}, tradition {t} : les deux éditions ne citent pas la même source "
                                 f"au rang {rang} ({source} / {autre[(n, t)][rang][1]})")
            if coupe:
                texte = extrait(texte, *coupe[LANGUE])
            cinq.append((t, texte, source))
        themes.append(cinq)
    return themes


def en_html(texte):
    return re.sub(r"\*([^*]+)\*", r"<em>\1</em>", texte)


CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; color: #f4ead2; font-family: 'EB Garamond', serif;
  background: radial-gradient(ellipse at 50% 8%, #1d3263 0%, #12224a 40%, #0b1530 78%); }
.sym { font-family: 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Serif Devanagari', serif; }
.haut { position: absolute; top: 62px; left: 84px; right: 84px; display: flex; justify-content: space-between;
  font-size: 21px; letter-spacing: 0.3em; text-transform: uppercase; color: #d9b766; }
h1 { position: absolute; top: 120px; left: 84px; right: 84px; font-family: 'Cormorant Garamond', serif;
  font-weight: 600; font-size: 74px; line-height: 1.02; color: #f8efd8; text-shadow: 0 0 22px rgba(255,220,150,.25); }
.filet { position: absolute; top: 232px; left: 84px; width: 130px; border-top: 2px solid #d9b766; }
.voix { position: absolute; top: 272px; bottom: 178px; left: 84px; right: 84px; display: flex;
  flex-direction: column; justify-content: space-evenly; font-size: 30px; }
.c { display: grid; grid-template-columns: 1.95em 1fr; column-gap: 0.85em; align-items: start; }
.s { width: 1.95em; height: 1.95em; border-radius: 50%; border: 2px solid #d9b766; background: rgba(11,21,48,.7);
  display: flex; align-items: center; justify-content: center; font-size: 1em; color: #f1d58e; margin-top: 0.05em; }
.q { font-style: italic; line-height: 1.28; hyphens: auto; }
.q em { font-style: normal; }
.q .sc { font-variant: small-caps; }
.src { margin-top: 0.3em; font-size: 0.56em; letter-spacing: 0.14em; text-transform: uppercase; color: #cdb98a; font-style: normal; }
.bas { position: absolute; bottom: 58px; left: 84px; right: 84px; display: flex; justify-content: space-between;
  align-items: flex-end; border-top: 1px solid rgba(217,183,102,.45); padding-top: 22px; }
.livre { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 38px; letter-spacing: 0.08em;
  text-transform: uppercase; color: #f8efd8; line-height: 1; }
.auteur { margin-top: 8px; font-size: 21px; letter-spacing: 0.32em; text-transform: uppercase; color: #e9d8ad; }
.formats { font-size: 20px; letter-spacing: 0.2em; text-transform: uppercase; color: #cdb98a; text-align: right; }
"""

AJUSTE = """<script>
document.fonts.ready.then(() => {
  const v = document.querySelector('.voix');
  let fs = 30;
  while (v.scrollHeight > v.clientHeight + 1 && fs > 19) { fs -= 0.5; v.style.fontSize = fs + 'px'; }
  document.body.dataset.taille = fs;
});
</script>"""


def page(corps, css=CSS):
    return f"""<!doctype html><html lang="{LANGUE}"><head><meta charset="utf-8">
<style>{kdp.css_polices()}\n{css}</style></head><body>{corps}{AJUSTE}</body></html>"""


def visuel_theme(n, cinq):
    voix = "".join(
        f'<div class="c"><div class="s sym">{kdp.SYMBOLES[TRADITIONS[t]]}</div><div class="q">{en_html(texte)}'
        f'<div class="src">{html.escape(TRADITIONS[t])} · {en_html(html.escape(source))}</div></div></div>'
        for t, texte, source in cinq)
    return page(f"""<div class="haut"><span>{T['serie']}</span><span>{n} / 18</span></div>
<h1>{html.escape(T['titres'][n - 1])}</h1><div class="filet"></div><div class="voix">{voix}</div>
<div class="bas"><div><div class="livre">{kdp.TITRE}</div><div class="auteur">{kdp.AUTEUR}</div></div>
<div class="formats">{T['formats']}</div></div>""")


def visuel_annonce():
    titre, accroche, formats, ou = T["annonce"]
    couverture = kdp.COVER_JPG.as_uri()
    css = CSS + """
.ann { position: absolute; top: 96px; left: 0; right: 0; text-align: center; font-size: 26px; letter-spacing: 0.34em;
  text-transform: uppercase; color: #d9b766; }
.couv { position: absolute; top: 160px; left: 50%; width: 470px; margin-left: -235px; box-shadow: 0 30px 80px rgba(0,0,0,.55),
  0 0 60px rgba(255,214,140,.18); border-radius: 4px; }
.acc { position: absolute; top: 928px; left: 110px; right: 110px; text-align: center; font-style: italic; font-size: 33px;
  line-height: 1.3; color: #f4ead2; }
.fmt { position: absolute; top: 1098px; left: 0; right: 0; text-align: center; font-size: 24px; letter-spacing: 0.22em;
  text-transform: uppercase; color: #f1d58e; }
.ou { position: absolute; top: 1146px; left: 60px; right: 60px; text-align: center; font-size: 23px; line-height: 1.5;
  color: #cdb98a; }
.syms { position: absolute; bottom: 46px; left: 0; right: 0; text-align: center; font-size: 30px; letter-spacing: 0.7em;
  color: #d9b766; }
"""
    syms = " ".join(kdp.SYMBOLES.values())
    corps = f"""<div class="ann">{titre}</div><img class="couv" src="{couverture}">
<div class="acc">{accroche}</div><div class="fmt">{formats}</div><div class="ou">{ou}</div>
<div class="syms sym">{syms}</div><div class="voix" style="display:none"></div>"""
    return page(corps, css)


def capture(html_text, png):
    tmp = Path(tempfile.mkdtemp(prefix="uml-visuel-")) / "v.html"
    tmp.write_text(html_text, encoding="utf-8")
    subprocess.run([kdp.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--window-size=1080,1350", "--virtual-time-budget=15000", f"--screenshot={png}", tmp.as_uri()],
                   check=True, capture_output=True)


def tailles(html_text):
    """Taille de police retenue par l'ajustement (Chrome --dump-dom après le script)."""
    tmp = Path(tempfile.mkdtemp(prefix="uml-visuel-")) / "v.html"
    tmp.write_text(html_text, encoding="utf-8")
    dom = subprocess.run([kdp.CHROME, "--headless=new", "--disable-gpu", "--window-size=1080,1350",
                          "--virtual-time-budget=15000", "--dump-dom", tmp.as_uri()],
                         check=True, capture_output=True, text=True).stdout
    m = re.search(r'data-taille="([\d.]+)"', dom)
    return float(m.group(1)) if m else None


def slug(texte):
    t = texte.lower().replace("œ", "oe").replace("'", " ").replace("’", " ")
    t = re.sub(r"[àâä]", "a", re.sub(r"[éèêë]", "e", re.sub(r"[îï]", "i", re.sub(r"[ôö]", "o", re.sub(r"[ûü]", "u", t)))))
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def main():
    SORTIE.mkdir(parents=True, exist_ok=True)
    for n, cinq in enumerate(selection(), start=1):
        h = visuel_theme(n, cinq)
        png = SORTIE / f"{n:02d}-{slug(T['titres'][n - 1])}.png"
        capture(h, png)
        fs = tailles(h)
        alerte = "  ← texte serré" if fs is not None and fs < 24 else ""
        print(f"{png.relative_to(ROOT)} — corps {fs}px, {sum(len(x[1]) for x in cinq)} caractères{alerte}")
    png = SORTIE / "00-annonce.png"
    capture(visuel_annonce(), png)
    print(f"{png.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
