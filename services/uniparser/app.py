"""Standalone UniParser (MolParser-Mobile) service. Not wired into MinerU/Agent."""

from __future__ import annotations

import io
import os
from pathlib import Path

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

REPO_ID = os.environ.get("UNIPARSER_REPO", "UniParser/MolParser-Mobile")
CACHE_DIR = os.environ.get(
    "UNIPARSER_CACHE",
    str(Path(__file__).resolve().parents[2] / "data" / "models" / "uniparser"),
)
HOST = os.environ.get("UNIPARSER_HOST", "127.0.0.1")
PORT = int(os.environ.get("UNIPARSER_PORT", "8200"))

app = FastAPI(title="UniParser MolParser-Mobile", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_processor = None
_device = "cpu"
_error: str | None = None


class PathRequest(BaseModel):
    image_path: str


def _snapshot_dir() -> Path:
    from huggingface_hub import snapshot_download

    Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)
    try:
        return Path(
            snapshot_download(REPO_ID, cache_dir=CACHE_DIR, local_files_only=True),
        )
    except Exception:
        return Path(
            snapshot_download(REPO_ID, cache_dir=CACHE_DIR, local_files_only=False),
        )


def _patch_init_context(model_cls: type) -> None:
    """MolParser Hub code targets a newer transformers get_init_context signature."""

    def get_init_context(cls, is_quantized, _is_ds_init_called=False, *args, **kwargs):  # noqa: ANN001
        from transformers.modeling_utils import PreTrainedModel, no_init_weights

        if is_quantized:
            return PreTrainedModel.get_init_context(is_quantized, _is_ds_init_called)
        # timm encoder calls tensor.item() during init; meta/empty weights cannot be used.
        return [no_init_weights()]

    model_cls.get_init_context = classmethod(get_init_context)


def _import_modeling(snapshot: Path):
    import importlib.util
    import sys

    path = snapshot / "modeling_molparser_mobile.py"
    spec = importlib.util.spec_from_file_location("modeling_molparser_mobile", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot_import:{path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["modeling_molparser_mobile"] = module
    spec.loader.exec_module(module)
    _patch_init_context(module.MolParserVisionEncoderDecoderModel)
    return module


def _load() -> None:
    global _model, _processor, _device, _error
    if _model is not None:
        return
    try:
        from transformers import AutoProcessor

        requested = os.environ.get("UNIPARSER_DEVICE", "cpu").strip().lower()
        if requested == "cuda" and torch.cuda.is_available():
            _device = "cuda"
        else:
            _device = "cpu"
        dtype = torch.float16 if _device == "cuda" else torch.float32
        snapshot = _snapshot_dir()
        modeling = _import_modeling(snapshot)
        _processor = AutoProcessor.from_pretrained(
            str(snapshot),
            trust_remote_code=True,
            local_files_only=True,
        )
        config = modeling.MolParserVisionEncoderDecoderConfig.from_pretrained(
            str(snapshot),
            trust_remote_code=True,
            local_files_only=True,
        )
        if getattr(config, "encoder", None) is not None:
            config.encoder.timm_pretrained = False
        _model = modeling.MolParserVisionEncoderDecoderModel.from_pretrained(
            str(snapshot),
            config=config,
            dtype=dtype,
            trust_remote_code=True,
            local_files_only=True,
            low_cpu_mem_usage=False,
        ).to(_device).eval()
        _error = None
    except Exception as exc:  # noqa: BLE001
        _error = str(exc)
        raise


def _recognize_image(image: Image.Image) -> str:
    _load()
    assert _model is not None and _processor is not None
    rgb = image.convert("RGB")
    inputs = _processor(images=rgb, return_tensors="pt")
    dtype = next(_model.parameters()).dtype
    inputs = {key: value.to(_device, dtype=dtype) if hasattr(value, "to") else value for key, value in inputs.items()}
    with torch.inference_mode():
        output_ids = _model.generate(**inputs, max_length=256, num_beams=1, do_sample=False)
    return _processor.batch_decode(output_ids, skip_special_tokens=True)[0]


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": _error is None,
        "service": "uniparser",
        "repo": REPO_ID,
        "device": _device,
        "loaded": _model is not None,
        "error": _error,
        "note": "standalone OCSR sidecar; not used by MinerU or Agent yet",
    }


@app.post("/load")
def load_model() -> dict[str, object]:
    try:
        _load()
    except Exception:  # noqa: BLE001
        return {**health(), "ok": False}
    return health()


@app.post("/recognize")
async def recognize_upload(file: UploadFile = File(...)) -> dict[str, object]:
    try:
        image = Image.open(io.BytesIO(await file.read()))
        caption = _recognize_image(image)
        return {"ok": True, "source": file.filename, "caption": caption, "repo": REPO_ID, "device": _device}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/recognize-path")
def recognize_path(body: PathRequest) -> dict[str, object]:
    path = Path(body.image_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"image_not_found:{path}")
    try:
        caption = _recognize_image(Image.open(path))
        return {"ok": True, "source": str(path), "caption": caption, "repo": REPO_ID, "device": _device}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
