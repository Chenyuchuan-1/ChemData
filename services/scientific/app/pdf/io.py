from __future__ import annotations

from pathlib import Path

import fitz

from app.config import settings


def pdf_passwords() -> list[str]:
    values: list[str] = []
    primary = (settings.pdf_password or "").strip()
    if primary:
        values.append(primary)
    extra = (settings.pdf_passwords or "").strip()
    if extra:
        values.extend(part.strip() for part in extra.split(",") if part.strip())
    seen: set[str] = set()
    unique: list[str] = []
    for item in values:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def open_pdf(path: str | Path) -> fitz.Document:
    doc = fitz.open(str(path))
    if not doc.needs_pass:
        return doc
    for password in pdf_passwords():
        if doc.authenticate(password):
            return doc
    doc.close()
    raise ValueError("document closed or encrypted")


def ensure_unlocked(path: str | Path) -> Path:
    """Authenticate if needed and persist an unencrypted copy in place."""
    dest = Path(path)
    doc = open_pdf(dest)
    try:
        if not doc.is_encrypted:
            return dest
        tmp = dest.with_name(f"{dest.name}.unlocked.tmp")
        doc.save(str(tmp), encryption=fitz.PDF_ENCRYPT_NONE, garbage=3, deflate=True)
    finally:
        doc.close()
    tmp.replace(dest)
    return dest
