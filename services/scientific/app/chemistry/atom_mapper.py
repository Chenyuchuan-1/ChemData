from __future__ import annotations

from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version

from app.config import settings
from app.schemas.chemistry import AtomMapResponse

from .rdkit_tools import validate_reaction_smiles


class AtomMapperAdapter:
    """Never invent atom maps. Return null when the mapper is missing or fails."""

    def __init__(self, name: str | None = None) -> None:
        self.name = (name or settings.atom_mapper or "rxnmapper").lower()

    def map(self, reaction_smiles: str) -> AtomMapResponse:
        validation = validate_reaction_smiles(reaction_smiles)
        if not validation.valid:
            return AtomMapResponse(
                atom_mapped_reaction_smiles=None,
                mapper=self.name,
                missing_reason="extraction_failed",
                error=validation.error,
            )

        if self.name in {"none", "off", "disabled"}:
            return AtomMapResponse(
                atom_mapped_reaction_smiles=None,
                mapper=self.name,
                missing_reason="not_applicable",
            )

        if self.name == "rxnmapper":
            mapped = self._map_rxnmapper(validation.canonical_reaction_smiles or reaction_smiles)
            return mapped

        return AtomMapResponse(
            atom_mapped_reaction_smiles=None,
            mapper=self.name,
            missing_reason="extraction_failed",
            error=f"unsupported_atom_mapper:{self.name}",
        )

    def _map_rxnmapper(self, reaction_smiles: str) -> AtomMapResponse:
        try:
            mapper = _load_rxnmapper()
        except Exception as exc:  # noqa: BLE001
            return AtomMapResponse(
                atom_mapped_reaction_smiles=None,
                mapper="rxnmapper",
                missing_reason="extraction_failed",
                error=f"atom_mapper_unavailable:{exc}",
            )

        try:
            results = mapper.get_attention_guided_atom_maps([reaction_smiles])
            mapped = None
            if results:
                mapped = results[0].get("mapped_rxn") or results[0].get("mapped_reaction")
            if not mapped:
                return AtomMapResponse(
                    atom_mapped_reaction_smiles=None,
                    mapper="rxnmapper",
                    missing_reason="extraction_failed",
                    error="mapper_returned_empty",
                )
            return AtomMapResponse(
                atom_mapped_reaction_smiles=mapped,
                mapper="rxnmapper",
            )
        except Exception as exc:  # noqa: BLE001
            return AtomMapResponse(
                atom_mapped_reaction_smiles=None,
                mapper="rxnmapper",
                missing_reason="extraction_failed",
                error=str(exc),
            )


@lru_cache(maxsize=1)
def _load_rxnmapper():
    from rxnmapper import RXNMapper

    return RXNMapper()


def mapper_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def atom_map_reaction(reaction_smiles: str) -> AtomMapResponse:
    result = AtomMapperAdapter().map(reaction_smiles)
    result.mapper_version = mapper_version(result.mapper)
    return result
