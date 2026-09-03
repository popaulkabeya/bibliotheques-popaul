#!/usr/bin/env python3
"""extract_pdf.py — Extrait et nettoie le texte d'un PDF pour la synthèse vocale.

Nettoyage : en-têtes courants répétés (détectés par fréquence sur la première
ligne de chaque page), pieds de page numériques isolés, dé-coupure des mots
scindés par un tiret de justification en fin de ligne, recollage des lignes
d'un même paragraphe.

Usage : python3 extract_pdf.py <fichier.pdf> [--skip-pages=N,M,...] > sortie.txt
Sortie : texte brut, paragraphes séparés par une ligne vide.
"""
import sys
import re
import argparse
from collections import Counter

import fitz

HYPHENS = "-‐‑‒"
PAGE_NUM_RE = re.compile(r"^\s*[—–\-]?\s*[ivxlcdmIVXLCDM\d]{1,6}\s*[—–\-]?\s*$")


def normalize_header(line):
    return re.sub(r"\d+", "", line).strip().lower()


def extract_pages(path):
    doc = fitz.open(path)
    return [doc[i].get_text("text") for i in range(len(doc))]


def strip_running_headers(pages):
    first_lines = []
    for p in pages:
        lines = [l for l in p.split("\n") if l.strip()]
        first_lines.append(lines[0] if lines else "")
    norm = [normalize_header(l) for l in first_lines]
    counts = Counter(n for n in norm if len(n) > 3)
    if not counts:
        return pages
    total = len(pages)
    boilerplate = {n for n, c in counts.items() if c / total > 0.3}
    if not boilerplate:
        return pages
    cleaned = []
    for p, n in zip(pages, norm):
        lines = p.split("\n")
        if n in boilerplate:
            for i, l in enumerate(lines):
                if l.strip():
                    lines[i] = ""
                    break
        cleaned.append("\n".join(lines))
    return cleaned


def clean_page(text):
    lines = text.split("\n")
    lines = [l for l in lines if not PAGE_NUM_RE.match(l)]
    return "\n".join(lines)


def join_paragraph(lines):
    out = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if out and out[-1] in HYPHENS and (line[:1].islower() or line[:1] == "'"):
            out = out[:-1] + line
        elif out:
            out = out + " " + line
        else:
            out = line
    return out


def pages_to_paragraphs(pages):
    paragraphs = []
    buf = []
    for page in pages:
        for line in page.split("\n"):
            if line.strip() == "":
                if buf:
                    paragraphs.append(join_paragraph(buf))
                    buf = []
            else:
                buf.append(line)
        if buf:
            paragraphs.append(join_paragraph(buf))
            buf = []
    return [p for p in paragraphs if p]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--skip-pages", default="")
    args = ap.parse_args()
    skip = {int(x) for x in args.skip_pages.split(",") if x.strip()}

    pages = extract_pages(args.pdf)
    pages = [p for i, p in enumerate(pages) if i not in skip]
    pages = strip_running_headers(pages)
    pages = [clean_page(p) for p in pages]
    paragraphs = pages_to_paragraphs(pages)

    sys.stdout.write("\n\n".join(paragraphs))


if __name__ == "__main__":
    main()
