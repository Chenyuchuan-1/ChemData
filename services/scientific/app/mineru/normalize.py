from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from app.schemas.mineru import ParsedBlock


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _join_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        parts = [part for part in (_join_text(item) for item in value) if part]
        return "\n".join(parts) if parts else None
    if isinstance(value, dict):
        for key in ("text", "content", "paragraph_content", "title_content", "math_content"):
            if key in value:
                return _join_text(value[key])
        return None
    return str(value)


def _normalize_bbox(bbox: list[float], page_size: list[float] | None) -> tuple[list[float], list[float]]:
    if not bbox or len(bbox) < 4:
        return [0, 0, 0, 0], [0, 0, 0, 0]
    raw = [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
    max_value = max(raw)
    if max_value <= 1.0:
        return raw, raw
    if page_size and len(page_size) >= 2 and page_size[0] > 0 and page_size[1] > 0:
        width, height = float(page_size[0]), float(page_size[1])
        # Page-point / pixel boxes fit inside page_size. MinerU content_list uses 0-1000.
        if raw[2] <= width * 1.05 and raw[3] <= height * 1.05:
            return raw, [raw[0] / width, raw[1] / height, raw[2] / width, raw[3] / height]
        if max_value <= 1000:
            return raw, [raw[0] / 1000.0, raw[1] / 1000.0, raw[2] / 1000.0, raw[3] / 1000.0]
        return raw, [raw[0] / width, raw[1] / height, raw[2] / width, raw[3] / height]
    if max_value <= 1000:
        return raw, [raw[0] / 1000.0, raw[1] / 1000.0, raw[2] / 1000.0, raw[3] / 1000.0]
    return raw, raw


def _page_size_from_middle(middle: dict[str, Any] | None) -> dict[int, list[float]]:
    sizes: dict[int, list[float]] = {}
    if not middle:
        return sizes
    for page in middle.get("pdf_info") or []:
        page_idx = int(page.get("page_idx", 0))
        size = page.get("page_size")
        if isinstance(size, list) and len(size) >= 2:
            sizes[page_idx] = [float(size[0]), float(size[1])]
    return sizes


def _flatten_content_list(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, str):
        payload = json.loads(payload)
    items: list[dict[str, Any]] = []
    if isinstance(payload, list) and payload and isinstance(payload[0], list):
        for page_idx, page_items in enumerate(payload):
            for item in page_items:
                if isinstance(item, dict):
                    item = dict(item)
                    item.setdefault("page_idx", page_idx)
                    items.append(item)
        return items
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _block_from_item(
    document_id: str,
    item: dict[str, Any],
    reading_order: int,
    page_sizes: dict[int, list[float]],
) -> ParsedBlock | None:
    page_idx = int(item.get("page_idx") or item.get("page_no") or 0)
    if item.get("page_no") and not item.get("page_idx"):
        page_idx = int(item["page_no"]) - 1
    page_no = page_idx + 1
    page_size = item.get("page_size") or page_sizes.get(page_idx)
    bbox, bbox_norm = _normalize_bbox(item.get("bbox") or [0, 0, 0, 0], page_size)

    block_type = str(item.get("type") or item.get("block_type") or "text")
    text = _join_text(
        item.get("text")
        or item.get("content")
        or item.get("table_body")
        or item.get("image_caption")
        or item.get("table_caption")
    )
    if block_type in {"title", "paragraph"} and not text:
        text = _join_text(item.get("content"))
    captions = _join_text(item.get("image_caption") or item.get("table_caption") or item.get("code_caption"))
    if captions and text and captions not in text:
        text = f"{captions}\n{text}"
    elif captions and not text:
        text = captions

    image_path = item.get("img_path") or item.get("image_path")
    if not text and not image_path:
        return None

    return ParsedBlock(
        id=str(uuid.uuid4()),
        document_id=document_id,
        page_no=page_no,
        block_type=block_type,
        text=text,
        bbox=bbox,
        bbox_norm=[max(0.0, min(1.0, value)) for value in bbox_norm],
        image_path=str(image_path) if image_path else None,
        reading_order=int(item.get("reading_order", reading_order)),
        meta={
            "text_level": item.get("text_level"),
            "sub_type": item.get("sub_type"),
            "page_size": page_size,
            "table_body": item.get("table_body"),
            "table_caption": item.get("table_caption"),
            "table_footnote": item.get("table_footnote"),
            "image_footnote": item.get("image_footnote"),
            "chunk_id": item.get("chunk_id"),
        },
    )


def normalize_mineru_outputs(
    document_id: str,
    output_dir: str | Path,
    page_sizes: list[list[float]] | None = None,
) -> list[ParsedBlock]:
    output_dir = Path(output_dir)
    mineru_dir = output_dir / "mineru"
    content_path = mineru_dir / "content_list.json"
    middle_path = mineru_dir / "middle.json"

    middle = None
    if middle_path.exists():
        middle = json.loads(middle_path.read_text(encoding="utf-8"))
        if isinstance(middle, str):
            middle = json.loads(middle)

    sizes = _page_size_from_middle(middle)
    if page_sizes:
        for idx, size in enumerate(page_sizes):
            sizes.setdefault(idx, size)

    items: list[dict[str, Any]] = []
    if content_path.exists():
        items = _flatten_content_list(json.loads(content_path.read_text(encoding="utf-8")))

    if not items and middle:
        for page in middle.get("pdf_info") or []:
            page_idx = int(page.get("page_idx", 0))
            for order, block in enumerate(page.get("para_blocks") or page.get("preproc_blocks") or []):
                text_parts = []
                for line in block.get("lines") or []:
                    for span in line.get("spans") or []:
                        if span.get("content"):
                            text_parts.append(span["content"])
                items.append(
                    {
                        "type": block.get("type", "text"),
                        "text": "".join(text_parts),
                        "bbox": block.get("bbox"),
                        "page_idx": page_idx,
                        "page_size": page.get("page_size"),
                        "reading_order": order,
                    }
                )

    blocks: list[ParsedBlock] = []
    for index, item in enumerate(items):
        block = _block_from_item(document_id, item, index, sizes)
        if block:
            blocks.append(block)
    return blocks
