from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
from bs4 import BeautifulSoup

from app.pdf.processor import crop_page


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _infer(value: str) -> Any:
    text = _clean(value)
    if text == "" or text.lower() in {"na", "n/a", "-", "—", "null"}:
        return None
    if text.endswith("%"):
        try:
            return float(text[:-1])
        except ValueError:
            return text
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    return text


def html_table_to_records(html: str) -> tuple[list[str], list[dict[str, Any]]]:
    if not html:
        return [], []
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if table is None:
        return [], []

    rows = table.find_all("tr")
    if not rows:
        return [], []

    header_cells = rows[0].find_all(["th", "td"])
    headers: list[str] = []
    used: dict[str, int] = {}
    for index, cell in enumerate(header_cells):
        name = _clean(cell.get_text(" ")) or f"col_{index + 1}"
        name = re.sub(r"[^\w\u4e00-\u9fff]+", "_", name).strip("_") or f"col_{index + 1}"
        count = used.get(name, 0) + 1
        used[name] = count
        headers.append(name if count == 1 else f"{name}_{count}")

    records: list[dict[str, Any]] = []
    for row in rows[1:]:
        cells = [_clean(cell.get_text(" ")) for cell in row.find_all(["td", "th"])]
        if not any(cells):
            continue
        record: dict[str, Any] = {}
        for index, header in enumerate(headers):
            record[header] = _infer(cells[index] if index < len(cells) else "")
        records.append(record)
    return headers, records


def _arrow_table(records: list[dict[str, Any]]) -> pa.Table:
    if not records:
        return pa.table({"_empty": pa.array([], type=pa.string())})
    columns = list(records[0].keys())
    data: dict[str, list[Any]] = {key: [row.get(key) for row in records] for key in columns}
    arrays = {}
    for key, values in data.items():
        if all(isinstance(value, bool) or value is None for value in values):
            arrays[key] = pa.array(values, type=pa.bool_())
        elif all(isinstance(value, int) or value is None for value in values) and not any(
            isinstance(value, bool) for value in values
        ):
            arrays[key] = pa.array(values, type=pa.int64())
        elif all(isinstance(value, (int, float)) or value is None for value in values) and not any(
            isinstance(value, bool) for value in values
        ):
            arrays[key] = pa.array(
                [None if value is None else float(value) for value in values],
                type=pa.float64(),
            )
        else:
            arrays[key] = pa.array(
                [None if value is None else str(value) for value in values],
                type=pa.string(),
            )
    return pa.table(arrays)


def materialize_table(
    *,
    table_id: str,
    output_dir: str | Path,
    html: str | None,
    title: str | None,
    description: str | None,
    page_no: int,
    bbox_norm: list[float],
    pdf_path: str,
    page_image_path: str | None = None,
) -> dict[str, Any]:
    output_dir = Path(output_dir)
    tables_dir = output_dir / "tables"
    images_dir = output_dir / "images"
    tables_dir.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    headers, records = html_table_to_records(html or "")
    parquet_rel = f"tables/{table_id}.parquet"
    image_rel = f"images/{table_id}.png"
    pq.write_table(_arrow_table(records), tables_dir / f"{table_id}.parquet")
    crop_page(
        bbox_norm=bbox_norm,
        output_path=images_dir / f"{table_id}.png",
        page_image_path=page_image_path,
        pdf_path=pdf_path,
        page_no=page_no,
        padding=0.012,
    )

    payload = {
        "table_id": table_id,
        "table_path": parquet_rel,
        "table_title": title,
        "table_description": description,
        "source_image_path": image_rel,
        "columns": headers,
        "row_count": len(records),
    }
    (tables_dir / f"{table_id}.payload.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload
