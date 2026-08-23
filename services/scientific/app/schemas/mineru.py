from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MinerUParseResult(BaseModel):
    document_id: str
    markdown_path: str | None = None
    content_list_path: str | None = None
    middle_json_path: str | None = None
    images_dir: str | None = None
    pages: list[dict[str, Any]] = Field(default_factory=list)
    parser: str = "mineru"
    backend: str | None = None
    warnings: list[str] = Field(default_factory=list)


class ParseRequest(BaseModel):
    document_id: str
    input_pdf: str
    output_dir: str
    start_page: int = 0
    end_page: int | None = None
    backend: str | None = None
    mode: str | None = None
    chunk_pages: int | None = None
    overlap: int | None = None
    force_chunked: bool = False


class ParsedBlock(BaseModel):
    id: str
    document_id: str
    page_no: int
    block_type: str
    text: str | None = None
    bbox: list[float]
    bbox_norm: list[float]
    image_path: str | None = None
    reading_order: int = 0
    meta: dict[str, Any] = Field(default_factory=dict)


class NormalizeRequest(BaseModel):
    document_id: str
    output_dir: str
    page_sizes: list[list[float]] | None = None


class RenderPagesRequest(BaseModel):
    pdf_path: str
    output_dir: str
    dpi: int = 144
    start_page: int = 0
    end_page: int | None = None


class CropRequest(BaseModel):
    pdf_path: str | None = None
    page_image_path: str | None = None
    page_no: int = 1
    bbox_norm: list[float]
    output_path: str
    padding: float = 0.01
