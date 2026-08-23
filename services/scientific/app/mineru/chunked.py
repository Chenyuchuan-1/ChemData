from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mineru.adapter import MinerUAdapter
from app.pdf.processor import pdf_info
from app.pdf.splitter import (
    chunk_from_dict,
    extract_chunk_pdfs,
    load_manifest,
    merge_chunk_artifacts,
    plan_chunks,
    save_manifest,
    specs_as_dicts,
)
from app.schemas.mineru import MinerUParseResult


def manifest_path(output_dir: Path) -> Path:
    return Path(output_dir) / "mineru" / "chunk_manifest.json"


def build_or_load_plan(
    input_pdf: Path,
    output_dir: Path,
    document_id: str,
    start_page: int = 0,
    end_page: int | None = None,
    chunk_pages: int | None = None,
    overlap: int | None = None,
) -> dict[str, Any]:
    output_dir = Path(output_dir)
    path = manifest_path(output_dir)
    existing = load_manifest(path)
    info = pdf_info(input_pdf)
    file_size = Path(input_pdf).stat().st_size
    planned = plan_chunks(
        page_count=info["page_count"],
        file_size_bytes=file_size,
        start_page=start_page,
        end_page=end_page,
        chunk_pages=chunk_pages,
        overlap=overlap,
    )
    if existing.get("chunks") and existing.get("input_pdf") == str(input_pdf):
        existing_ranges = [(item.get("start_page"), item.get("end_page")) for item in existing["chunks"]]
        planned_ranges = [(spec.start_page, spec.end_page) for spec in planned]
        if existing_ranges == planned_ranges:
            return existing

    chunks_dir = output_dir / "chunks"
    extract_chunk_pdfs(input_pdf, planned, chunks_dir)

    payload = {
        "document_id": document_id,
        "input_pdf": str(input_pdf),
        "page_count": info["page_count"],
        "file_size_bytes": file_size,
        "start_page": start_page,
        "end_page": end_page,
        "chunk_count": len(planned),
        "chunks": specs_as_dicts(planned),
        "status": "planned",
    }
    save_manifest(path, payload)
    return payload


async def parse_one_chunk(
    adapter: MinerUAdapter,
    output_dir: Path,
    chunk_id: str,
    backend: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    path = manifest_path(output_dir)
    manifest = load_manifest(path)
    chunks = manifest.get("chunks") or []
    target = next((item for item in chunks if item["chunk_id"] == chunk_id), None)
    if not target:
        raise ValueError(f"unknown_chunk:{chunk_id}")
    if target.get("status") == "completed":
        return manifest

    chunk_output = Path(output_dir) / "chunks" / chunk_id
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            result = await adapter.parse_document(
                input_pdf=Path(target["pdf_path"]),
                output_dir=chunk_output,
                document_id=f"{manifest.get('document_id')}:{chunk_id}",
                start_page=0,
                end_page=target["page_count"] - 1,
                backend=backend,
                mode=mode,
            )
            target["status"] = "completed"
            target["error"] = None
            target["parser"] = result.parser
            target["warnings"] = result.warnings
            last_error = None
            break
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            target["status"] = "retrying"
            target["error"] = str(exc)
            save_manifest(path, manifest)
    if last_error is not None:
        target["status"] = "failed"
        target["error"] = str(last_error)
    completed = sum(1 for item in chunks if item.get("status") == "completed")
    failed = sum(1 for item in chunks if item.get("status") == "failed")
    manifest["status"] = "parsing" if completed + failed < len(chunks) else "chunks_done"
    manifest["completed_chunks"] = completed
    manifest["failed_chunks"] = failed
    save_manifest(path, manifest)
    return manifest


def merge_parsed_chunks(output_dir: Path, document_id: str) -> MinerUParseResult:
    path = manifest_path(output_dir)
    manifest = load_manifest(path)
    chunks = [chunk_from_dict(item) for item in manifest.get("chunks") or []]
    completed = [chunk for chunk in chunks if chunk.status == "completed"]
    artifacts = merge_chunk_artifacts(Path(output_dir), completed, overlap_policy="keep_first")
    manifest["status"] = "merged"
    save_manifest(path, manifest)
    warnings = [f"merged_{len(completed)}_of_{len(chunks)}_chunks"]
    failed = [chunk.chunk_id for chunk in chunks if chunk.status != "completed"]
    if failed:
        warnings.append("incomplete_chunks:" + ",".join(failed))
    return MinerUParseResult(
        document_id=document_id,
        parser="mineru-chunked",
        backend=manifest.get("backend"),
        warnings=warnings,
        **artifacts,
    )


async def parse_document_chunked(
    adapter: MinerUAdapter,
    input_pdf: Path,
    output_dir: Path,
    document_id: str,
    start_page: int = 0,
    end_page: int | None = None,
    chunk_pages: int | None = None,
    overlap: int | None = None,
    backend: str | None = None,
    mode: str | None = None,
) -> MinerUParseResult:
    manifest = build_or_load_plan(
        input_pdf=input_pdf,
        output_dir=output_dir,
        document_id=document_id,
        start_page=start_page,
        end_page=end_page,
        chunk_pages=chunk_pages,
        overlap=overlap,
    )
    for item in manifest.get("chunks") or []:
        if item.get("status") == "completed":
            continue
        await parse_one_chunk(adapter, Path(output_dir), item["chunk_id"], backend=backend, mode=mode)
    return merge_parsed_chunks(Path(output_dir), document_id)
