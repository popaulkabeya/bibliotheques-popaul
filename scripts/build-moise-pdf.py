#!/usr/bin/env python3
"""Build the French and English Moses editions as print-ready PDFs from Markdown.

Google Fonts are fetched during the build and embedded by Chrome. Images resolve
from the book directory, matching the relative paths used in the Markdown.
"""
import argparse
import html
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / "Septieme-Livres-de-Moise"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
STEM = "Sixieme-et-Septieme-Livres-de-Moise"


def typo(s):
    s = re.sub(r" (?=[:;!?»])", "\u00a0", s)
    return re.sub(r"« ", "«\u00a0", s)


def inline(text, fr):
    # Protect escaped source text before applying the small Markdown inline set.
    text = html.escape(text, quote=False)
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)",
                  lambda m: f'<figure><img src="{html.escape(m[2], quote=True)}" alt="{m[1]}"><figcaption>{m[1]}</figcaption></figure>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    return typo(text) if fr else text


def markdown_to_html(text, fr):
    lines = text.splitlines()
    out, para, quote, listing = [], [], [], None

    def flush_para():
        if para:
            out.append("<p>" + "<br>\n".join(inline(x, fr) for x in para) + "</p>")
            para.clear()

    def flush_quote():
        if quote:
            body = " ".join(x.strip() for x in quote)
            out.append('<blockquote><p>' + inline(body, fr) + '</p></blockquote>')
            quote.clear()

    def flush_list():
        nonlocal listing
        if listing:
            tag, items = listing
            out.append(f"<{tag}>" + "".join(f"<li>{inline(x, fr)}</li>" for x in items) + f"</{tag}>")
            listing = None

    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            flush_para(); flush_quote(); flush_list(); i += 1; continue
        if re.fullmatch(r"\s*---+\s*", line):
            flush_para(); flush_quote(); flush_list(); out.append("<hr>"); i += 1; continue
        hm = re.match(r"^(#{1,3})\s+(.+?)\s*#*\s*$", line)
        if hm:
            flush_para(); flush_quote(); flush_list()
            level = len(hm[1]); out.append(f"<h{level}>{inline(hm[2], fr)}</h{level}>"); i += 1; continue
        if line.lstrip().startswith(">"):
            flush_para(); flush_list(); quote.append(re.sub(r"^\s*> ?", "", line)); i += 1; continue
        lm = re.match(r"^\s*(?:[-*+]\s+|\d+\.\s+)(.*)$", line)
        if lm:
            flush_para(); flush_quote()
            tag = "ol" if re.match(r"^\s*\d+\.", line) else "ul"
            if listing and listing[0] != tag: flush_list()
            if not listing: listing = (tag, [])
            listing[1].append(lm[1]); i += 1; continue
        if re.match(r"^\s*!\[.*\]\(.*\)\s*$", line):
            flush_para(); flush_quote(); flush_list(); out.append(inline(line.strip(), fr)); i += 1; continue
        flush_quote(); flush_list(); para.append(line.strip()); i += 1
    flush_para(); flush_quote(); flush_list()
    return "\n".join(out)


def document(lang):
    fr = lang == "FR"
    src = BOOK / f"{STEM}-{lang}.md"
    title = "LES SIXIÈME ET SEPTIÈME LIVRES DE MOÏSE" if fr else "THE SIXTH AND SEVENTH BOOKS OF MOSES"
    subtitle = "Traduction française intégrale" if fr else "Complete English edition"
    engraving = "ornée des gravures de l’édition de 1880" if fr else "with the engravings of the 1880 edition"
    body = markdown_to_html(src.read_text(encoding="utf-8"), fr)
    # The first Markdown heading is repeated on the requested designed cover.
    body = re.sub(r"^<h1>.*?</h1>\s*", "", body, count=1)
    fonts = ("https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=Playfair+Display:wght@500;600;700&display=swap")
    css = """
@page { size: A5; margin: 17mm 16mm 18mm; }
@page:first { margin: 0; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'EB Garamond', Georgia, serif; color:#28251f; font-size:11.5pt; line-height:1.48; }
.cover { height:210mm; page-break-after:always; break-after:page; background:#182238; color:#f4eedf; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:22mm; }
.cover:before { content:''; position:absolute; inset:12mm; border:1px solid #bda66d; }
.cover h1 { font:600 30pt/1.22 'Playfair Display',serif; letter-spacing:.035em; color:#f2e8cb; text-transform:uppercase; max-width:145mm; }
.cover .rule { width:34mm; height:1px; background:#bda66d; margin:10mm auto; }
.cover p { font:italic 15pt/1.45 'EB Garamond',serif; color:#e5dcc6; margin:1mm 0; }
main h1 { font:600 24pt/1.2 'Playfair Display',serif; text-align:center; margin:0 0 9mm; page-break-before:always; }
main h2 { font:600 19pt/1.25 'Playfair Display',serif; margin:9mm 0 4mm; page-break-after:avoid; }
main h3 { font:600 14pt/1.3 'Playfair Display',serif; margin:6mm 0 2.5mm; page-break-after:avoid; }
p { margin:0 0 3.2mm; orphans:3; widows:3; }
strong { font-weight:600; } blockquote { margin:3mm 4mm 5mm; padding-left:4mm; border-left:1.2pt solid #a58d59; color:#4c463a; }
ul,ol { padding-left:7mm; margin:1mm 0 4mm; } li { margin:0 0 1mm; }
hr { border:0; border-top:.5pt solid #bcae8e; margin:6mm auto; width:35%; }
figure { margin:6mm auto; text-align:center; page-break-inside:avoid; break-inside:avoid; }
figure img { display:block; max-width:100%; max-height:225mm; width:auto; height:auto; margin:0 auto; object-fit:contain; }
figcaption { margin-top:1.5mm; font-size:8.5pt; color:#625b4e; font-style:italic; line-height:1.25; }
"""
    return (f'<!doctype html><html lang="{"fr" if fr else "en"}"><head><meta charset="utf-8"><title>{html.escape(title)}</title>'
            f'<link rel="stylesheet" href="{fonts}"><style>{css}</style></head><body>'
            f'<section class="cover"><h1>{html.escape(title)}</h1><div class="rule"></div>'
            f'<p>{html.escape(subtitle)}</p><p>{html.escape(engraving)}</p></section>'
            f'<main>{body}</main></body></html>')


def build(lang):
    out = BOOK / f"{STEM}-{lang}.pdf"
    # HTML lives in a temp dir at the repository root: from ROOT/<tmp>/edition.html,
    # the Markdown's "../Septieme-Livres-de-Moise/Gravures/…" paths resolve to the real folder.
    with tempfile.TemporaryDirectory(prefix="moise-pdf-", dir=ROOT) as td:
        page = Path(td) / "edition.html"
        page.write_text(document(lang), encoding="utf-8")
        pdf = Path(td) / "edition.pdf"
        try:
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                            f"--user-data-dir={Path(td) / 'chrome-profile'}",
                            "--virtual-time-budget=30000", f"--print-to-pdf={pdf}", page.as_uri()],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except (subprocess.CalledProcessError, OSError) as exc:
            # Some macOS managed runners abort Chrome before it creates a PDF. Keep
            # the same HTML/Markdown source and produce a faithful flowable PDF.
            print(f"Chrome indisponible ({exc}); rendu de secours ReportLab.")
            fallback_pdf(lang, pdf)
        from pypdf import PdfReader
        reader = PdfReader(str(pdf))
        if len(reader.pages) <= 150:
            raise SystemExit(f"{lang}: seulement {len(reader.pages)} pages, génération interrompue")
        images = sum(len(p.images) for p in reader.pages)
        if not images:
            raise SystemExit(f"{lang}: aucune image détectée dans le PDF")
        out.write_bytes(pdf.read_bytes())
    size = out.stat().st_size
    print(f"{out}: {len(reader.pages)} pages, {size:,} octets, {images} images")


def fallback_pdf(lang, output):
    """ReportLab fallback for runners where the installed Chrome binary aborts."""
    import markdown
    from bs4 import BeautifulSoup, NavigableString, Tag
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
    from reportlab.lib.pagesizes import A5
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (BaseDocTemplate, Frame, Image, PageBreak,
                                    PageTemplate, Paragraph, Spacer, KeepTogether,
                                    HRFlowable, ListFlowable, ListItem)

    fr = lang == "FR"
    source = (BOOK / f"{STEM}-{lang}.md").read_text(encoding="utf-8")
    source = re.sub(r"^# .+\n+", "", source, count=1)
    rendered = markdown.markdown(source, extensions=["extra", "sane_lists"])
    soup = BeautifulSoup(rendered, "html.parser")
    regular = "/System/Library/Fonts/Supplemental/Georgia.ttf"
    bold = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
    italic = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
    bolditalic = "/System/Library/Fonts/Supplemental/Georgia Bold Italic.ttf"
    for name, path in (("Georgia", regular), ("Georgia-Bold", bold),
                       ("Georgia-Italic", italic), ("Georgia-BoldItalic", bolditalic)):
        if Path(path).exists(): pdfmetrics.registerFont(TTFont(name, path))
    pdfmetrics.registerFontFamily("Georgia", normal="Georgia", bold="Georgia-Bold",
                                  italic="Georgia-Italic", boldItalic="Georgia-BoldItalic")

    class Doc(BaseDocTemplate):
        def __init__(self, filename):
            super().__init__(filename, pagesize=A5, leftMargin=17*mm, rightMargin=16*mm,
                             topMargin=17*mm, bottomMargin=18*mm, title=STEM)
            frame = Frame(self.leftMargin, self.bottomMargin,
                          A5[0]-self.leftMargin-self.rightMargin,
                          A5[1]-self.topMargin-self.bottomMargin, id="body")
            self.addPageTemplates([PageTemplate(id="all", frames=frame, onPage=self.paint)])
        def paint(self, canvas, doc):
            if doc.page == 1:
                canvas.saveState(); canvas.setFillColor(colors.HexColor("#182238")); canvas.rect(0,0,*A5,fill=1,stroke=0)
                canvas.setStrokeColor(colors.HexColor("#bda66d")); canvas.rect(12*mm,12*mm,A5[0]-24*mm,A5[1]-24*mm,fill=0,stroke=1)
                canvas.setFillColor(colors.HexColor("#f2e8cb")); canvas.setFont("Georgia-Bold",20)
                title = "LES SIXIÈME ET SEPTIÈME LIVRES DE MOÏSE" if fr else "THE SIXTH AND SEVENTH BOOKS OF MOSES"
                words = title.split(); rows=[]; row=""
                for word in words:
                    test=(row+" "+word).strip()
                    if pdfmetrics.stringWidth(test,"Georgia-Bold",20)>A5[0]-42*mm:
                        rows.append(row); row=word
                    else: row=test
                if row: rows.append(row)
                y=A5[1]*.57+len(rows)*13
                for line in rows:
                    canvas.drawCentredString(A5[0]/2,y,line); y-=26
                canvas.setStrokeColor(colors.HexColor("#bda66d")); canvas.line(A5[0]/2-17*mm,y-8,A5[0]/2+17*mm,y-8)
                canvas.setFillColor(colors.HexColor("#e5dcc6")); canvas.setFont("Georgia-Italic",12)
                subs=["Traduction française intégrale", "ornée des gravures de l’édition de 1880"] if fr else ["Complete English edition", "with the engravings of the 1880 edition"]
                for sub in subs: y-=25; canvas.drawCentredString(A5[0]/2,y,sub)
                canvas.restoreState()
            else:
                canvas.saveState(); canvas.setFont("Georgia",8); canvas.setFillColor(colors.HexColor("#776f60"))
                canvas.drawCentredString(A5[0]/2,9*mm,str(doc.page-1)); canvas.restoreState()

    styles = getSampleStyleSheet()
    body = ParagraphStyle("Book", parent=styles["BodyText"], fontName="Georgia", fontSize=9.4,
                          leading=13.2, alignment=TA_JUSTIFY, spaceAfter=5, textColor=colors.HexColor("#28251f"))
    headings = [ParagraphStyle(f"H{i}", parent=body, fontName="Georgia-Bold", fontSize=s,
                              leading=s*1.23, alignment=TA_CENTER if i==1 else TA_LEFT,
                              spaceBefore=13 if i<3 else 8, spaceAfter=7, keepWithNext=True)
                for i,s in ((1,18),(2,15),(3,11.5))]
    caption = ParagraphStyle("Caption", parent=body, fontSize=7, leading=8.5,
                             alignment=TA_CENTER, textColor=colors.HexColor("#625b4e"), spaceAfter=2)
    story = [Spacer(1,1), PageBreak()]
    width, height = A5[0]-33*mm, A5[1]-35*mm

    def markup(node):
        if isinstance(node, NavigableString): return html.escape(str(node))
        if not isinstance(node, Tag): return ""
        inner="".join(markup(c) for c in node.children)
        tag=node.name
        return f"<{tag}>{inner}</{tag}>" if tag in ("b","strong","i","em","sup","sub","br","code") else inner

    for node in soup.contents:
        if not isinstance(node,Tag): continue
        if node.name in ("h1","h2","h3"):
            story.append(Paragraph(markup(node), headings[int(node.name[1])-1]))
        elif node.name == "p":
            img=node.find("img")
            if img:
                src=(BOOK / img.get("src","")).resolve()
                if src.exists():
                    im=Image(str(src)); scale=min(width/im.imageWidth,(height-30)/im.imageHeight,1)
                    im.drawWidth=im.imageWidth*scale; im.drawHeight=im.imageHeight*scale
                    group=[im]
                    if img.get("alt"): group.append(Paragraph(html.escape(img["alt"]),caption))
                    story.append(KeepTogether(group)); story.append(Spacer(1,7))
            elif node.get_text(strip=True): story.append(Paragraph(markup(node),body))
        elif node.name == "blockquote":
            story.append(Paragraph("<i>"+markup(node)+"</i>",body))
        elif node.name in ("ul","ol"):
            items=[]
            for li in node.find_all("li",recursive=False): items.append(ListItem(Paragraph(markup(li),body)))
            story.append(ListFlowable(items,bulletType="1" if node.name=="ol" else "bullet",leftIndent=12))
        elif node.name == "hr": story.append(HRFlowable(width="35%",hAlign="CENTER",spaceBefore=8,spaceAfter=8))
    Doc(str(output)).build(story)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--fr", action="store_true", help="construire l’édition française")
    group.add_argument("--en", action="store_true", help="construire l’édition anglaise")
    group.add_argument("--all", action="store_true", help="construire les deux éditions (défaut)")
    args = parser.parse_args()
    langs = ["FR"] if args.fr else ["EN"] if args.en else ["FR", "EN"]
    for lang in langs:
        build(lang)


if __name__ == "__main__":
    main()
