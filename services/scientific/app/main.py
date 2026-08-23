from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.chemistry.atom_mapper import atom_map_reaction
from app.chemistry.rdkit_tools import depict, generate_rxn, validate_reaction_smiles, validate_smiles
from app.config import settings
from app.mineru.adapter import MinerUAdapter
from app.mineru.chunked import (
    build_or_load_plan,
    merge_parsed_chunks,
    parse_document_chunked,
    parse_one_chunk,
)
from app.mineru.normalize import normalize_mineru_outputs
from app.pdf.processor import crop_page, pdf_info, render_pages
from app.pdf.splitter import load_manifest
from app.tables.materialize import html_table_to_records, materialize_table
from app.schemas.chemistry import (
    AtomMapRequest,
    DepictRequest,
    GenerateRxnRequest,
    ValidateReactionRequest,
    ValidateSmilesRequest,
)
from app.schemas.mineru import CropRequest, NormalizeRequest, ParseRequest, RenderPagesRequest

app = FastAPI(title="Chem PDF Scientific Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

adapter = MinerUAdapter()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "service": "scientific",
        "mineru_mode": settings.mineru_mode,
        "mineru_api_url": settings.mineru_api_url,
        "atom_mapper": settings.atom_mapper,
    }


@app.post("/parse")
async def parse_document(request: ParseRequest):
    try:
        info = pdf_info(request.input_pdf)
        last = request.end_page if request.end_page is not None else info["page_count"] - 1
        span = last - request.start_page + 1
        use_chunked = request.force_chunked or span > 24 or Path(request.input_pdf).stat().st_size > 20 * 1024 * 1024
        if use_chunked:
            result = await parse_document_chunked(
                adapter,
                input_pdf=Path(request.input_pdf),
                output_dir=Path(request.output_dir),
                document_id=request.document_id,
                start_page=request.start_page,
                end_page=request.end_page,
                chunk_pages=request.chunk_pages or settings.mineru_chunk_pages,
                overlap=request.overlap if request.overlap is not None else settings.mineru_chunk_overlap,
                backend=request.backend,
                mode=request.mode,
            )
        else:
            result = await adapter.parse_document(
                input_pdf=Path(request.input_pdf),
                output_dir=Path(request.output_dir),
                document_id=request.document_id,
                start_page=request.start_page,
                end_page=request.end_page,
                backend=request.backend,
                mode=request.mode,
            )
        return result.model_dump()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/parse/plan")
def parse_plan(request: ParseRequest):
    return build_or_load_plan(
        input_pdf=Path(request.input_pdf),
        output_dir=Path(request.output_dir),
        document_id=request.document_id,
        start_page=request.start_page,
        end_page=request.end_page,
        chunk_pages=request.chunk_pages or settings.mineru_chunk_pages,
        overlap=request.overlap if request.overlap is not None else settings.mineru_chunk_overlap,
    )


@app.post("/parse/chunk")
async def parse_chunk(payload: dict):
    try:
        return await parse_one_chunk(
            adapter,
            output_dir=Path(payload["output_dir"]),
            chunk_id=payload["chunk_id"],
            backend=payload.get("backend"),
            mode=payload.get("mode"),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/parse/merge")
def parse_merge(payload: dict):
    result = merge_parsed_chunks(Path(payload["output_dir"]), payload["document_id"])
    return result.model_dump()


@app.get("/parse/manifest")
def parse_manifest(output_dir: str):
    return load_manifest(Path(output_dir) / "mineru" / "chunk_manifest.json")


@app.post("/tables/materialize")
def tables_materialize(payload: dict):
    try:
        return materialize_table(
            table_id=payload["table_id"],
            output_dir=payload["output_dir"],
            html=payload.get("html"),
            title=payload.get("title"),
            description=payload.get("description"),
            page_no=int(payload["page_no"]),
            bbox_norm=payload["bbox_norm"],
            pdf_path=payload["pdf_path"],
            page_image_path=payload.get("page_image_path"),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/tables/preview")
def tables_preview(payload: dict):
    headers, records = html_table_to_records(payload.get("html") or "")
    return {"columns": headers, "row_count": len(records), "preview": records[:8]}


@app.post("/normalize-blocks")
def normalize_blocks(request: NormalizeRequest):
    blocks = normalize_mineru_outputs(
        document_id=request.document_id,
        output_dir=request.output_dir,
        page_sizes=request.page_sizes,
    )
    return {"blocks": [block.model_dump() for block in blocks]}


@app.post("/pdf/info")
def get_pdf_info(payload: dict[str, str]):
    try:
        return pdf_info(payload["pdf_path"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/pdf/render-pages")
def render_pdf_pages(request: RenderPagesRequest):
    try:
        pages = render_pages(
            pdf_path=request.pdf_path,
            output_dir=request.output_dir,
            dpi=request.dpi,
            start_page=request.start_page,
            end_page=request.end_page,
        )
        return {"pages": pages}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/pdf/crop")
def crop(request: CropRequest):
    try:
        path = crop_page(
            bbox_norm=request.bbox_norm,
            output_path=request.output_path,
            page_image_path=request.page_image_path,
            pdf_path=request.pdf_path,
            page_no=request.page_no,
            padding=request.padding,
        )
        return {"path": path}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/chemistry/validate-smiles")
def smiles_endpoint(request: ValidateSmilesRequest):
    return validate_smiles(request.smiles).model_dump()


@app.post("/chemistry/validate-reaction")
def reaction_endpoint(request: ValidateReactionRequest):
    return validate_reaction_smiles(request.reaction_smiles).model_dump()


@app.post("/chemistry/atom-map")
def atom_map_endpoint(request: AtomMapRequest):
    return atom_map_reaction(request.reaction_smiles).model_dump()


@app.post("/chemistry/generate-rxn")
def rxn_endpoint(request: GenerateRxnRequest):
    return generate_rxn(request.reaction_smiles, request.output_path, request.reaction_name).model_dump()


@app.post("/chemistry/depict")
def depict_endpoint(request: DepictRequest):
    return depict(request.smiles, request.reaction_smiles, request.width, request.height).model_dump()
