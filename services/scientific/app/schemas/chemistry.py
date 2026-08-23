from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

MissingReason = Literal[
    "source_not_present",
    "unreadable",
    "not_applicable",
    "extraction_failed",
    "pending_review",
    "redacted_or_restricted",
]


class ValidateSmilesRequest(BaseModel):
    smiles: str


class ValidateSmilesResponse(BaseModel):
    valid: bool
    canonical_smiles: str | None = None
    error: str | None = None


class ValidateReactionRequest(BaseModel):
    reaction_smiles: str


class ValidateReactionResponse(BaseModel):
    valid: bool
    canonical_reaction_smiles: str | None = None
    reactant_count: int | None = None
    product_count: int | None = None
    error: str | None = None


class AtomMapRequest(BaseModel):
    reaction_smiles: str


class AtomMapResponse(BaseModel):
    atom_mapped_reaction_smiles: str | None = None
    mapper: str
    mapper_version: str | None = None
    missing_reason: MissingReason | None = None
    error: str | None = None


class GenerateRxnRequest(BaseModel):
    reaction_smiles: str
    output_path: str
    reaction_name: str | None = None


class GenerateRxnResponse(BaseModel):
    rxn_path: str | None = None
    rxn_text: str | None = None
    missing_reason: MissingReason | None = None
    error: str | None = None


class DepictRequest(BaseModel):
    smiles: str | None = None
    reaction_smiles: str | None = None
    width: int = 420
    height: int = 160


class DepictResponse(BaseModel):
    image_base64: str | None = None
    error: str | None = None
    parts: list[dict[str, Any]] = Field(default_factory=list)
