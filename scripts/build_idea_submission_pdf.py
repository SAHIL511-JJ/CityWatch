from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "artifacts" / "idea-submission-draft.md"
OUTPUT = ROOT / "output" / "pdf" / "citiwatch-idea-submission-draft.pdf"
FONT_DIR = Path(r"C:\Windows\Fonts")

pdfmetrics.registerFont(TTFont("SegoeUI", str(FONT_DIR / "segoeui.ttf")))
pdfmetrics.registerFont(TTFont("SegoeUI-Bold", str(FONT_DIR / "segoeuib.ttf")))
pdfmetrics.registerFont(TTFont("SegoeUI-Italic", str(FONT_DIR / "segoeuii.ttf")))

NAVY = colors.HexColor("#12283E")
SLATE = colors.HexColor("#40586B")
TEAL = colors.HexColor("#167B78")
PALE = colors.HexColor("#EAF4F3")
LINE = colors.HexColor("#D9E3E9")
MIST = colors.HexColor("#F7F9FA")


def inline_markup(value: str) -> str:
    escaped = html.escape(value, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    return escaped


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="CoverTitle",
        fontName="SegoeUI-Bold",
        fontSize=29,
        leading=34,
        textColor=NAVY,
        alignment=TA_LEFT,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverSubtitle",
        fontName="SegoeUI",
        fontSize=15,
        leading=22,
        textColor=TEAL,
        spaceAfter=18,
    )
)
styles.add(
    ParagraphStyle(
        name="H1Custom",
        fontName="SegoeUI-Bold",
        fontSize=18,
        leading=23,
        textColor=NAVY,
        spaceBefore=18,
        spaceAfter=8,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="H2Custom",
        fontName="SegoeUI-Bold",
        fontSize=13.5,
        leading=18,
        textColor=TEAL,
        spaceBefore=11,
        spaceAfter=5,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="BodyCustom",
        fontName="SegoeUI",
        fontSize=10.4,
        leading=15.6,
        textColor=SLATE,
        spaceAfter=7,
    )
)
styles.add(
    ParagraphStyle(
        name="BulletCustom",
        parent=styles["BodyCustom"],
        leftIndent=15,
        firstLineIndent=-8,
        bulletIndent=3,
        spaceAfter=4,
    )
)
styles.add(
    ParagraphStyle(
        name="Callout",
        fontName="SegoeUI-Bold",
        fontSize=11.5,
        leading=17,
        textColor=NAVY,
        backColor=PALE,
        borderColor=colors.HexColor("#B7D7D4"),
        borderWidth=0.7,
        borderPadding=10,
        spaceBefore=6,
        spaceAfter=12,
    )
)
styles.add(
    ParagraphStyle(
        name="FlowLine",
        fontName="SegoeUI-Bold",
        fontSize=11,
        leading=18,
        textColor=TEAL,
        alignment=TA_CENTER,
        spaceBefore=3,
        spaceAfter=10,
    )
)


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(MIST)
    canvas.rect(0, height - 13 * mm, width, 13 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.setFont("SegoeUI-Bold", 8)
    canvas.drawString(20 * mm, height - 8.5 * mm, "CITIWATCH  /  IDEA SUBMISSION DRAFT")
    canvas.setFillColor(SLATE)
    canvas.setFont("SegoeUI", 8)
    canvas.drawRightString(width - 20 * mm, 12 * mm, f"{doc.page:02d}")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(20 * mm, 18 * mm, width - 20 * mm, 18 * mm)
    canvas.restoreState()


def parse_markdown(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    story = []
    paragraph = []
    first_title = True

    def flush_paragraph():
        nonlocal paragraph
        if not paragraph:
            return
        text = " ".join(x.strip() for x in paragraph)
        if text.startswith("**") and text.endswith("**"):
            story.append(Paragraph(inline_markup(text), styles["Callout"]))
        elif text.startswith("**Observe"):
            story.append(Paragraph(inline_markup(text), styles["FlowLine"]))
        else:
            story.append(Paragraph(inline_markup(text), styles["BodyCustom"]))
        paragraph = []

    for raw in lines:
        line = raw.strip()
        if not line:
            flush_paragraph()
            continue
        if line.startswith("# "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[2:]), styles["CoverTitle"]))
            if first_title:
                story.append(HRFlowable(width="100%", thickness=1.2, color=TEAL, spaceAfter=14))
                first_title = False
            continue
        if line.startswith("## "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[3:]), styles["H1Custom"]))
            continue
        if line.startswith("### "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[4:]), styles["H2Custom"]))
            continue
        if line.startswith("- "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[2:]), styles["BulletCustom"], bulletText="•"))
            continue
        numbered = re.match(r"^(\d+)\.\s+(.*)$", line)
        if numbered:
            flush_paragraph()
            story.append(
                Paragraph(
                    inline_markup(numbered.group(2)),
                    styles["BulletCustom"],
                    bulletText=f"{numbered.group(1)}.",
                )
            )
            continue
        paragraph.append(line)
    flush_paragraph()
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    page_width, page_height = A4
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=25 * mm,
        bottomMargin=24 * mm,
        title="CitiWatch Idea Submission Draft",
        author="CitiWatch",
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="main",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="default", frames=frame, onPage=header_footer)])
    story = parse_markdown(SOURCE)
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
