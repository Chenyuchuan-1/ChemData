#!/usr/bin/env python3
"""Create a small chemistry PDF for end-to-end verification."""

from pathlib import Path

import fitz


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    dest = root / "samples" / "esterification_demo.pdf"
    dest.parent.mkdir(parents=True, exist_ok=True)

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    text = """Esterification of Ethanol and Acetic Acid

Scheme 1. Fischer esterification.

General conditions: catalyst H2SO4, 80 °C, 2 h, solvent-free.

Ethanol reacts with acetic acid under sulfuric acid catalysis to afford ethyl acetate and water.

reaction SMILES:
CCO.CC(=O)O>>CC(=O)OCC.O

LaTeX:
$$\\mathrm{C_2H_5OH + CH_3COOH \\rightarrow CH_3COOC_2H_5 + H_2O}$$

Substrate table
3a 85%
3b 78%
3c 81%
3d 73%

The four entries share the general conditions stated above.
"""
    page.insert_text((56, 64), text, fontsize=12, fontname="helv")

    page2 = doc.new_page(width=595, height=842)
    page2.insert_text(
        (56, 64),
        """Experimental section

A mixture of ethanol (1.0 equiv) and acetic acid (1.2 equiv) was treated with H2SO4
and heated at 80 °C for 2 h. The product ethyl acetate was isolated.

Do not invent additional reagents that are not written here.
Yield of the parent reaction is 85%.
""",
        fontsize=12,
        fontname="helv",
    )
    doc.save(dest)
    doc.close()
    print(dest)


if __name__ == "__main__":
    main()
