
import sys, io
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

doc = Document(sys.argv[1])
body = doc.element.body
out = []
for child in body.iterchildren():
    if child.tag.endswith('}p'):
        p = Paragraph(child, doc)
        t = p.text.strip()
        if t:
            style = p.style.name if p.style is not None else ''
            out.append(f"[{style}] {t}")
    elif child.tag.endswith('}tbl'):
        tbl = Table(child, doc)
        out.append("=== TABLE ===")
        for row in tbl.rows:
            cells = [c.text.replace("\n"," / ").strip() for c in row.cells]
            out.append(" | ".join(cells))
        out.append("=== END TABLE ===")
with open(sys.argv[2], 'w', encoding='utf-8') as f:
    f.write("\n".join(out))
print("chars", len("\n".join(out)))
