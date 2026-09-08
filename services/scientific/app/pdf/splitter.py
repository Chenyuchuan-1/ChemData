from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, Literal

import fitz

from app.pdf.io import open_pdf

OverlapPolicy = Literal["keep_first", "keep_latest"]


@dataclass
class ChunkSpec:
    chunk_id: str
    start_page: int
    end_page: int
    page_count: int
    overlap_with_previous: int
    pdf_path: str
    status: str = "pending"
    error: str | None = None


def adaptive_chunk_size(page_count: int, file_size_bytes: int) -> tuple[int, int]:
    """Choose a memory-safe window from page weight. Scanned books get smaller chunks."""
    mb_per_page = (file_size_bytes / (1024 * 1024)) / max(page_count, 1)
    if mb_per_page >= 0.22:
        return 8, 1
    if mb_per_page >= 0.08:
        return 16, 1
    return 24, 2


def plan_chunks(
    page_count: int,
    file_size_bytes: int,
    start_page: int = 0,
    end_page: int | None = None,
    chunk_pages: int | None = None,
    overlap: int | None = None,
) -> list[ChunkSpec]:
    last = page_count - 1 if end_page is None else min(end_page, page_count - 1)
    first = max(0, start_page)
    if last < first:
        return []

    if chunk_pages is None or overlap is None:
        adaptive_pages, adaptive_overlap = adaptive_chunk_size(page_count, file_size_bytes)
        chunk_pages = chunk_pages or adaptive_pages
        overlap = adaptive_overlap if overlap is None else overlap

    chunk_pages = max(1, chunk_pages)
    overlap = max(0, min(overlap, chunk_pages - 1))

    chunks: list[ChunkSpec] = []
    cursor = first
    index = 1
    while cursor <= last:
        end = min(cursor + chunk_pages - 1, last)
        overlap_prev = 0 if not chunks else overlap
        chunks.append(
            ChunkSpec(
                chunk_id=f"c{index:04d}",
                start_page=cursor,
                end_page=end,
                page_count=end - cursor + 1,
                overlap_with_previous=overlap_prev,
                pdf_path="",
            )
        )
        if end >= last:
            break
        cursor = end - overlap + 1
        index += 1
    return chunks


def extract_chunk_pdf(source_pdf: Path, dest_pdf: Path, start_page: int, end_page: int) -> str:
    """Copy a page range without rasterizing. Returns sha256 of the chunk file."""
    dest_pdf.parent.mkdir(parents=True, exist_ok=True)
    src = open_pdf(source_pdf)
    out = fitz.open()
    try:
        out.insert_pdf(src, from_page=start_page, to_page=end_page)
        out.save(str(dest_pdf), garbage=3, deflate=True)
    finally:
        out.close()
        src.close()
    return _sha256_file(dest_pdf)


def extract_chunk_pdfs(source_pdf: Path, chunks: list[ChunkSpec], chunks_dir: Path) -> list[ChunkSpec]:
    """Open the source PDF once and write every missing chunk. Safe to resume."""
    chunks_dir.mkdir(parents=True, exist_ok=True)
    src = open_pdf(source_pdf)
    try:
        for spec in chunks:
            dest = chunks_dir / spec.chunk_id / "chunk.pdf"
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists() and dest.stat().st_size > 0:
                spec.pdf_path = str(dest)
                continue
            out = fitz.open()
            try:
                out.insert_pdf(src, from_page=spec.start_page, to_page=spec.end_page)
                out.save(str(dest), garbage=3, deflate=True)
            finally:
                out.close()
            spec.pdf_path = str(dest)
    finally:
        src.close()
    return chunks


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def chunk_from_dict(item: dict[str, Any]) -> ChunkSpec:
    allowed = {field.name for field in fields(ChunkSpec)}
    return ChunkSpec(**{key: value for key, value in item.items() if key in allowed})


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _flatten_content_list(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, list) and payload and isinstance(payload[0], list):
        items: list[dict[str, Any]] = []
        for page_idx, page_items in enumerate(payload):
            for item in page_items:
                if isinstance(item, dict):
                    row = dict(item)
                    row.setdefault("page_idx", page_idx)
                    items.append(row)
        return items
    if isinstance(payload, list):
        return [dict(item) for item in payload if isinstance(item, dict)]
    return []


def _rewrite_image_path(value: Any, chunk_id: str) -> Any:
    if not isinstance(value, str) or not value:
        return value
    name = Path(value).name
    return f"images/{chunk_id}_{name}"


def merge_chunk_artifacts(
    output_dir: Path,
    chunks: list[ChunkSpec],
    overlap_policy: OverlapPolicy = "keep_first",
) -> dict[str, str | None]:
    mineru_dir = output_dir / "mineru"
    images_dir = mineru_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    markdown_parts: list[str] = []
    merged_items: list[dict[str, Any]] = []
    seen_pages: set[int] = set()
    middle: dict[str, Any] = {"pdf_info": [], "_backend": "pipeline", "_version_name": "chunked"}

    for chunk in chunks:
        chunk_dir = output_dir / "chunks" / chunk.chunk_id / "mineru"
        md = chunk_dir / "markdown.md"
        if md.exists():
            markdown_parts.append(
                f"\n\n<!-- mineru-chunk {chunk.chunk_id} pages {chunk.start_page + 1}-{chunk.end_page + 1} -->\n\n"
            )
            markdown_parts.append(md.read_text(encoding="utf-8"))

        src_images = chunk_dir / "images"
        rename: dict[str, str] = {}
        if src_images.exists():
            for image in src_images.iterdir():
                if not image.is_file():
                    continue
                dest_name = f"{chunk.chunk_id}_{image.name}"
                dest = images_dir / dest_name
                if not dest.exists():
                    dest.write_bytes(image.read_bytes())
                rename[image.name] = dest_name
                rename[f"images/{image.name}"] = f"images/{dest_name}"

        items = _flatten_content_list(_load_json(chunk_dir / "content_list.json"))
        skip_pages = set(seen_pages) if overlap_policy == "keep_first" else set()
        for item in items:
            local_idx = int(item.get("page_idx") or 0)
            global_idx = chunk.start_page + local_idx
            if global_idx in skip_pages:
                continue
            row = dict(item)
            row["page_idx"] = global_idx
            row["chunk_id"] = chunk.chunk_id
            for key in ("img_path", "image_path"):
                if key in row:
                    raw = str(row[key])
                    row[key] = f"images/{rename.get(Path(raw).name, Path(raw).name)}"
            merged_items.append(row)
            seen_pages.add(global_idx)

        middle_payload = _load_json(chunk_dir / "middle.json")
        if isinstance(middle_payload, dict):
            for page in middle_payload.get("pdf_info") or []:
                page_idx = int(page.get("page_idx") or 0) + chunk.start_page
                if page_idx in {item.get("page_idx") for item in middle["pdf_info"]} and overlap_policy == "keep_first":
                    continue
                cloned = dict(page)
                cloned["page_idx"] = page_idx
                middle["pdf_info"].append(cloned)

    md_path = mineru_dir / "markdown.md"
    md_path.write_text("".join(markdown_parts).strip() + "\n", encoding="utf-8")
    content_path = mineru_dir / "content_list.json"
    content_path.write_text(json.dumps(merged_items, ensure_ascii=False, indent=2), encoding="utf-8")
    middle_path = mineru_dir / "middle.json"
    middle_path.write_text(json.dumps(middle, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "markdown_path": str(md_path),
        "content_list_path": str(content_path),
        "middle_json_path": str(middle_path),
        "images_dir": str(images_dir) if any(images_dir.iterdir()) else None,
    }


def chunk_specs_from_manifest(manifest: dict[str, Any]) -> list[ChunkSpec]:
    return [ChunkSpec(**item) for item in manifest.get("chunks") or []]


def specs_as_dicts(chunks: list[ChunkSpec]) -> list[dict[str, Any]]:
    return [asdict(chunk) for chunk in chunks]
