from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import httpx

from app.config import settings
from app.schemas.mineru import MinerUParseResult


def _copy_if_exists(src: Path, dest: Path) -> Path | None:
    if not src.exists():
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.resolve() == dest.resolve():
        return dest
    if src.is_dir():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        return dest
    shutil.copy2(src, dest)
    return dest


def discover_mineru_artifacts(search_root: Path) -> dict[str, Path | None]:
    """Find MinerU outputs even if the directory layout changes between versions."""
    found: dict[str, Path | None] = {
        "markdown": None,
        "content_list": None,
        "middle": None,
        "images": None,
    }
    if not search_root.exists():
        return found

    md_files = list(search_root.rglob("*.md"))
    if md_files:
        md_files.sort(key=lambda p: (0 if "full" in p.name.lower() else 1, len(p.parts), p.stat().st_size * -1))
        found["markdown"] = md_files[0]

    for pattern in ("*content_list.json", "*content_list_v2.json"):
        matches = list(search_root.rglob(pattern))
        if matches:
            found["content_list"] = matches[0]
            break

    middle = list(search_root.rglob("*_middle.json")) + list(search_root.rglob("middle.json"))
    if middle:
        found["middle"] = middle[0]

    image_dirs = [p for p in search_root.rglob("images") if p.is_dir()]
    if image_dirs:
        found["images"] = image_dirs[0]
    return found


def materialize_artifacts(
    artifacts: dict[str, Path | None],
    dest_dir: Path,
) -> dict[str, str | None]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "markdown_path": None,
        "content_list_path": None,
        "middle_json_path": None,
        "images_dir": None,
    }
    if artifacts.get("markdown"):
        copied = _copy_if_exists(artifacts["markdown"], dest_dir / "markdown.md")
        paths["markdown_path"] = str(copied) if copied else None
    if artifacts.get("content_list"):
        copied = _copy_if_exists(artifacts["content_list"], dest_dir / "content_list.json")
        paths["content_list_path"] = str(copied) if copied else None
    if artifacts.get("middle"):
        copied = _copy_if_exists(artifacts["middle"], dest_dir / "middle.json")
        paths["middle_json_path"] = str(copied) if copied else None
    if artifacts.get("images"):
        copied = _copy_if_exists(artifacts["images"], dest_dir / "images")
        paths["images_dir"] = str(copied) if copied else None
    return paths


def write_json_artifact(dest: Path, payload: Any) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(payload, str):
        dest.write_text(payload, encoding="utf-8")
    else:
        dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return dest


class MinerUAdapter:
    def __init__(
        self,
        mode: str | None = None,
        api_url: str | None = None,
        backend: str | None = None,
    ) -> None:
        self.mode = (mode or settings.mineru_mode).lower()
        self.api_url = (api_url or settings.mineru_api_url).rstrip("/")
        self.backend = backend or settings.mineru_backend

    async def parse_document(
        self,
        input_pdf: Path,
        output_dir: Path,
        document_id: str,
        start_page: int = 0,
        end_page: int | None = None,
        backend: str | None = None,
        mode: str | None = None,
    ) -> MinerUParseResult:
        input_pdf = Path(input_pdf)
        output_dir = Path(output_dir)
        mineru_dir = output_dir / "mineru"
        mineru_dir.mkdir(parents=True, exist_ok=True)

        used_backend = backend or self.backend
        used_mode = (mode or self.mode).lower()
        warnings: list[str] = []

        try:
            if used_mode == "api":
                try:
                    result = await self._parse_via_api(
                        input_pdf=input_pdf,
                        mineru_dir=mineru_dir,
                        document_id=document_id,
                        start_page=start_page,
                        end_page=end_page,
                        backend=used_backend,
                    )
                    result.warnings.extend(warnings)
                    return result
                except Exception as exc:  # noqa: BLE001
                    warnings.append(f"MinerU API failed, falling back to CLI: {exc}")
                    used_mode = "cli"

            if used_mode == "cli":
                return await self._parse_via_cli(
                    input_pdf=input_pdf,
                    mineru_dir=mineru_dir,
                    document_id=document_id,
                    start_page=start_page,
                    end_page=end_page,
                    backend=used_backend,
                    warnings=warnings,
                )

            raise RuntimeError(f"Unsupported MINERU_MODE={used_mode}")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"MinerU parse failed: {exc}")
            fallback = await self._parse_via_pymupdf(
                input_pdf=input_pdf,
                mineru_dir=mineru_dir,
                document_id=document_id,
                start_page=start_page,
                end_page=end_page,
                warnings=warnings,
            )
            return fallback

    async def _parse_via_api(
        self,
        input_pdf: Path,
        mineru_dir: Path,
        document_id: str,
        start_page: int,
        end_page: int | None,
        backend: str,
    ) -> MinerUParseResult:
        timeout = httpx.Timeout(timeout=1800.0, connect=20.0)
        data = {
            "backend": backend,
            "parse_method": "auto",
            "return_md": "true",
            "return_middle_json": "true",
            "return_model_output": "false",
            "return_content_list": "true",
            "return_images": "true",
            "start_page_id": str(start_page),
            "end_page_id": str(end_page if end_page is not None else 99999),
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            with input_pdf.open("rb") as handle:
                response = await client.post(
                    f"{self.api_url}/file_parse",
                    data=data,
                    files={"files": (input_pdf.name, handle, "application/pdf")},
                )
            if response.status_code >= 400:
                raise RuntimeError(f"MinerU API {response.status_code}: {response.text[:800]}")
            payload = response.json()

        results = payload.get("results") or {}
        first = next(iter(results.values()), {}) if isinstance(results, dict) else {}

        if first.get("md_content"):
            write_json_artifact(mineru_dir / "markdown.md", first["md_content"])
        if first.get("content_list"):
            write_json_artifact(mineru_dir / "content_list.json", first["content_list"])
        if first.get("middle_json"):
            write_json_artifact(mineru_dir / "middle.json", first["middle_json"])

        images_dir = mineru_dir / "images"
        images_dir.mkdir(exist_ok=True)
        images = first.get("images") or {}
        if isinstance(images, dict):
            import base64

            for name, data_url in images.items():
                raw = data_url
                if isinstance(raw, str) and "," in raw:
                    raw = raw.split(",", 1)[1]
                (images_dir / Path(str(name)).name).write_bytes(base64.b64decode(raw))

        artifacts = discover_mineru_artifacts(mineru_dir)
        paths = materialize_artifacts(artifacts, mineru_dir)
        return MinerUParseResult(
            document_id=document_id,
            parser="mineru",
            backend=backend,
            **paths,
        )

    async def _parse_via_cli(
        self,
        input_pdf: Path,
        mineru_dir: Path,
        document_id: str,
        start_page: int,
        end_page: int | None,
        backend: str,
        warnings: list[str],
    ) -> MinerUParseResult:
        mineru_bin = shutil.which("mineru")
        if not mineru_bin:
            raise RuntimeError("mineru CLI is not installed in the current environment")

        with tempfile.TemporaryDirectory(prefix="mineru-cli-") as tmp:
            cmd = [
                mineru_bin,
                "-p",
                str(input_pdf),
                "-o",
                tmp,
                "-b",
                backend,
                "-s",
                str(start_page),
            ]
            if end_page is not None:
                cmd.extend(["-e", str(end_page)])

            env = os.environ.copy()
            env.setdefault("MINERU_MODEL_SOURCE", settings.mineru_model_source)

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise RuntimeError(
                    f"mineru CLI failed ({process.returncode}): {(stderr or stdout).decode('utf-8', 'ignore')[-1200:]}"
                )

            artifacts = discover_mineru_artifacts(Path(tmp))
            if not any(artifacts.values()):
                warnings.append("MinerU CLI finished but no artifacts were discovered")
            paths = materialize_artifacts(artifacts, mineru_dir)

        return MinerUParseResult(
            document_id=document_id,
            parser="mineru",
            backend=backend,
            warnings=warnings,
            **paths,
        )

    async def _parse_via_pymupdf(
        self,
        input_pdf: Path,
        mineru_dir: Path,
        document_id: str,
        start_page: int,
        end_page: int | None,
        warnings: list[str],
    ) -> MinerUParseResult:
        """Last-resort parser so the workbench still works if MinerU is unavailable."""
        import fitz

        doc = fitz.open(str(input_pdf))
        last = end_page if end_page is not None else doc.page_count - 1
        last = min(last, doc.page_count - 1)
        blocks_out: list[dict[str, Any]] = []
        md_parts: list[str] = []

        for index in range(max(start_page, 0), last + 1):
            page = doc[index]
            md_parts.append(f"\n\n## Page {index + 1}\n")
            page_dict = page.get_text("dict")
            width, height = page.rect.width, page.rect.height
            reading = 0
            for block in page_dict.get("blocks", []):
                if block.get("type") != 0:
                    continue
                lines = []
                for line in block.get("lines", []):
                    text = "".join(span.get("text", "") for span in line.get("spans", []))
                    if text.strip():
                        lines.append(text)
                text = "\n".join(lines).strip()
                if not text:
                    continue
                x0, y0, x1, y1 = block["bbox"]
                item = {
                    "type": "text",
                    "text": text,
                    "bbox": [x0, y0, x1, y1],
                    "page_idx": index,
                    "page_size": [width, height],
                    "reading_order": reading,
                }
                blocks_out.append(item)
                md_parts.append(text)
                reading += 1
        doc.close()

        md_path = mineru_dir / "markdown.md"
        md_path.write_text("\n\n".join(md_parts).strip() + "\n", encoding="utf-8")
        content_path = write_json_artifact(mineru_dir / "content_list.json", blocks_out)
        warnings.append("Used PyMuPDF fallback parser because MinerU was unavailable")
        return MinerUParseResult(
            document_id=document_id,
            markdown_path=str(md_path),
            content_list_path=str(content_path),
            parser="pymupdf-fallback",
            backend="fallback",
            warnings=warnings,
        )
