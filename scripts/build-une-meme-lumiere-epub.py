#!/usr/bin/env python3
"""
build-une-meme-lumiere-epub.py — L'e-book EPUB 3 d'« Une même lumière » (Kindle, Kobo, Apple Books,
Google Play), tiré du même texte que le livre broché, dans docs/edition-amazon/.

La couverture (Une-Meme-Lumiere-couverture-ebook.jpg) est intégrée si elle existe : lancer d'abord
build-une-meme-lumiere-couverture.py. Les symboles des cinq traditions sont retirés des intertitres,
car de nombreuses liseuses n'ont pas de police pour les afficher.

Usage : python3 scripts/build-une-meme-lumiere-epub.py [--lang=en]
"""
import html
import importlib.util
import re
import uuid
import zipfile
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("kdp", ROOT / "scripts" / "build-une-meme-lumiere-kdp.py")
kdp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kdp)

TEXTES = {
    "fr": {"page_titre": "Page de titre", "dedicace": "Dédicace", "debut": "Début", "droits": "Tous droits réservés.",
           "note": "Les traductions anciennes citées (Bible du Rabbinat français, Louis Segond, Kazimirski, Burnouf, Hû, "
                   "Langlois,\nLoiseleur-Deslongchamps, Schwab) appartiennent au domaine public. Les passages traduits "
                   "pour ce livre portent la\nmention «&#8239;trad. de travail&#8239;»."},
    "en": {"page_titre": "Title Page", "dedicace": "Dedication", "debut": "Start", "droits": "All rights reserved.",
           "note": "The older translations and editions quoted, listed in the Sources, and the World English Bible "
                   "are in the public domain; the English renderings of the French ones are the author’s. The passages "
                   "translated for this book from other sources bear the words “working translation.”"},
}[kdp.LANGUE]


CSS_EPUB = """
body { font-family: serif; line-height: 1.45; margin: 0 4%; }
p { margin: 0; text-indent: 1.2em; text-align: justify; }
h1 { text-align: center; font-size: 1.5em; margin: 2em 0 0.4em; page-break-before: always; }
h1 .k { display: block; font-size: 0.6em; font-variant: small-caps; letter-spacing: 0.15em; font-weight: normal; }
h2 { font-size: 1.25em; margin: 1.6em 0 0.5em; }
h2.chapitre { text-align: center; page-break-before: always; }
h2.chapitre .num { display: block; font-size: 1.4em; }
h3 { font-size: 1em; font-variant: small-caps; letter-spacing: 0.06em; margin: 1.3em 0 0.4em; }
h2 + p, h3 + p, h4 + p, .ref + p, blockquote + p { text-indent: 0; }
blockquote { margin: 0.6em 0 0 1.2em; font-size: 0.95em; }
blockquote p { text-indent: 0; margin-bottom: 0.3em; }
p.ref { font-size: 0.8em; text-align: right; text-indent: 0; margin: 0.2em 0 0.9em; }
span.sc { font-variant: small-caps; letter-spacing: 0.04em; }
p.part-intro { font-style: italic; text-align: center; text-indent: 0; margin: 0 1em 1.5em; }
.synthese { border-top: 1px solid #999; border-bottom: 1px solid #999; margin: 1.2em 0; padding: 0.4em 0; }
.synthese h4 { font-variant: small-caps; letter-spacing: 0.1em; margin: 0.5em 0 0.3em; }
table { border-collapse: collapse; width: 100%; font-size: 0.75em; margin: 1em 0; }
th, td { border-bottom: 1px solid #aaa; padding: 0.2em; text-align: left; vertical-align: top; }
.centre { text-align: center; text-indent: 0; }
.titre h1 { page-break-before: auto; font-size: 2em; margin-top: 3em; }
.dedicace { margin-top: 5em; }
.dedicace p { font-style: italic; text-align: center; text-indent: 0; margin: 0 1.5em; }
.petit p { font-size: 0.8em; text-indent: 0; margin-bottom: 0.7em; text-align: left; }
nav ol { list-style-type: none; }
"""


def xhtml(titre, corps):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{kdp.LANGUE}" xml:lang="{kdp.LANGUE}">
<head><meta charset="utf-8"/><title>{html.escape(titre)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>{corps}</body></html>"""


def en_xml(fragment):
    """HTML → XHTML bien formé (balises fermées, entités nommées remplacées)."""
    soup = BeautifulSoup(fragment, "html.parser")
    for sym in soup.find_all("span", class_="sym"):  # symboles absents des polices de nombreuses liseuses
        sym.decompose()
    x = soup.decode(formatter="minimal")
    return re.sub(r"<(br|hr|img[^>]*?)\s*/?>", lambda m: f"<{m.group(1)}/>", x)


def construire_epub(sections):
    docs, nav = [], []
    titre_page = f"""<div class="titre"><h1>{kdp.TITRE}</h1><p class="centre"><em>{kdp.SOUS_TITRE}</em></p>
<p class="centre" style="margin-top:2em">{kdp.AUTEUR}</p></div>
<div class="petit" style="margin-top:4em"><p>© {kdp.AUTEUR}, {kdp.ANNEE}. {TEXTES["droits"]}</p>
<p>{TEXTES["note"]}</p></div>"""
    docs.append(("titre.xhtml", TEXTES["page_titre"], titre_page))
    docs.append(("dedicace.xhtml", TEXTES["dedicace"], f'<div class="dedicace"><p>{kdp.E["dedicace"]}</p></div>'))
    for i, s in enumerate(sections):
        k = f'<span class="k">{html.escape(s["kicker"])}</span>' if s["kicker"] else ""
        corps = f'<h1>{k}{html.escape(s["titre"])}</h1>' + kdp.contenu_html(s["contenu"])
        nom = f"s{i:02d}.xhtml"
        docs.append((nom, s["brut"], corps))
        sous = []
        for j, h in enumerate(BeautifulSoup(corps, "html.parser").find_all("h2")):
            if "chapitre" in (h.get("class") or []):
                sous.append((f"{nom}#c{j}", h.get_text(". ", strip=True)))
        nav.append((nom, s["brut"], sous))
    ident = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, 'une-meme-lumiere-popaul-kabeya-' + kdp.LANGUE)}"

    def ancrer(corps):  # ancres des chapitres pour la table de navigation
        soup = BeautifulSoup(corps, "html.parser")
        for j, h in enumerate(soup.find_all("h2")):
            h["id"] = f"c{j}"
        return str(soup)

    nav_li = "".join(
        f'<li><a href="{f}">{html.escape(t)}</a>'
        + (f'<ol>{"".join(f"<li><a href={chr(34)}{a}{chr(34)}>{html.escape(st)}</a></li>" for a, st in sous)}</ol>' if sous else "")
        + "</li>" for f, t, sous in nav)
    nav_doc = xhtml(kdp.E["table"], f'<nav epub:type="toc" id="toc"><h1>{kdp.E["table"]}</h1><ol>{nav_li}</ol></nav>'
                    f'<nav epub:type="landmarks" hidden=""><ol><li><a epub:type="bodymatter" href="{nav[0][0]}">{TEXTES["debut"]}</a></li></ol></nav>')
    manifest = "".join(f'<item id="d{n}" href="{f}" media-type="application/xhtml+xml"/>' for n, (f, _, _) in enumerate(docs))
    spine = "".join(f'<itemref idref="d{n}"/>' for n in range(len(docs)))
    a_couverture = kdp.COVER_JPG.exists()
    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="{kdp.LANGUE}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">{ident}</dc:identifier><dc:title>{kdp.TITRE}</dc:title>
<dc:creator>{kdp.AUTEUR}</dc:creator><dc:language>{kdp.LANGUE}</dc:language><dc:date>{kdp.ANNEE}</dc:date>
<dc:description>{html.escape(kdp.SOUS_TITRE)}</dc:description>
<meta property="dcterms:modified">{kdp.ANNEE}-10-18T00:00:00Z</meta>
{'<meta name="cover" content="cover"/>' if a_couverture else ''}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
{'<item id="cover" href="couverture.jpg" media-type="image/jpeg" properties="cover-image"/><item id="cp" href="couverture.xhtml" media-type="application/xhtml+xml"/>' if a_couverture else ''}
{manifest}</manifest>
<spine>{'<itemref idref="cp"/>' if a_couverture else ''}{spine}</spine></package>"""
    with zipfile.ZipFile(kdp.EPUB_OUT, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile '
                   'full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/style.css", CSS_EPUB, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", en_xml_doc(nav_doc), compress_type=zipfile.ZIP_DEFLATED)
        if a_couverture:
            z.write(kdp.COVER_JPG, "OEBPS/couverture.jpg", compress_type=zipfile.ZIP_STORED)
            z.writestr("OEBPS/couverture.xhtml", xhtml(kdp.TITRE, f'<div style="text-align:center"><img src="couverture.jpg" alt="{kdp.TITRE}" style="max-width:100%;height:auto"/></div>'),
                       compress_type=zipfile.ZIP_DEFLATED)
        for f, t, corps in docs:
            z.writestr(f"OEBPS/{f}", xhtml(t, en_xml(ancrer(corps))), compress_type=zipfile.ZIP_DEFLATED)
    return len(docs), a_couverture


def en_xml_doc(doc):
    return doc  # la page de navigation est déjà écrite en XHTML


def main():
    kdp.OUT.mkdir(parents=True, exist_ok=True)
    soup = kdp.lire_html()
    kdp.typographie(soup)
    sections = kdp.decouper(soup)
    for s in sections:
        kdp.orner(s["contenu"])
    n, couv = construire_epub(sections)
    print(f"EPUB : {kdp.EPUB_OUT.relative_to(ROOT)} — {n} fichiers de texte, couverture "
          f"{'incluse' if couv else 'absente (lancer d’abord build-une-meme-lumiere-couverture.py)'}")


if __name__ == "__main__":
    main()
