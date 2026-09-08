from __future__ import annotations

from pathlib import Path
from typing import Any

import fitz
from PIL import Image

from app.pdf.io import ensure_unlocked, open_pdf


def pdf_info(pdf_path: str | Path) -> dict[str, Any]:
    pdf_path = ensure_unlocked(pdf_path)
    doc = open_pdf(pdf_path)
    try:
        pages = []
        for index, page in enumerate(doc):
            rect = page.rect
            pages.append(
                {
                    "page_no": index + 1,
                    "width": float(rect.width),
                    "height": float(rect.height),
                }
            )
        return {
            "page_count": doc.page_count,
            "pages": pages,
        }
    finally:
        doc.close()


def render_pages(
    pdf_path: str | Path,
    output_dir: str | Path,
    dpi: int = 144,
    start_page: int = 0,
    end_page: int | None = None,
) -> list[dict[str, Any]]:
    pdf_path = Path(pdf_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    doc = open_pdf(pdf_path)
    last = end_page if end_page is not None else doc.page_count - 1
    last = min(last, doc.page_count - 1)
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    rendered: list[dict[str, Any]] = []
    try:
        for index in range(max(start_page, 0), last + 1):
            page = doc[index]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            dest = output_dir / f"page_{index + 1:04d}.png"
            pix.save(str(dest))
            rendered.append(
                {
                    "page_no": index + 1,
                    "path": str(dest),
                    "width": pix.width,
                    "height": pix.height,
                }
            )
    finally:
        doc.close()
    return rendered


def crop_page(
    bbox_norm: list[float],
    output_path: str | Path,
    page_image_path: str | Path | None = None,
    pdf_path: str | Path | None = None,
    page_no: int = 1,
    padding: float = 0.01,
) -> str:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    x1, y1, x2, y2 = [float(v) for v in bbox_norm]
    x1 = max(0.0, x1 - padding)
    y1 = max(0.0, y1 - padding)
    x2 = min(1.0, x2 + padding)
    y2 = min(1.0, y2 + padding)

    if page_image_path and Path(page_image_path).exists():
        image = Image.open(page_image_path)
        width, height = image.size
        box = (
            int(x1 * width),
            int(y1 * height),
            int(x2 * width),
            int(y2 * height),
        )
        image.crop(box).save(output_path)
        return str(output_path)

    if not pdf_path:
        raise ValueError("Either page_image_path or pdf_path is required")

    doc = open_pdf(pdf_path)
    try:
        page = doc[page_no - 1]
        rect = page.rect
        clip = fitz.Rect(
            x1 * rect.width,
            y1 * rect.height,
            x2 * rect.width,
            y2 * rect.height,
        )
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
        pix.save(str(output_path))
    finally:
        doc.close()
    return str(output_path)
