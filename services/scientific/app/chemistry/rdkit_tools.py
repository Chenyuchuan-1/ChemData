from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import AllChem, Draw, rdChemReactions

from app.schemas.chemistry import (
    DepictResponse,
    GenerateRxnResponse,
    ValidateReactionResponse,
    ValidateSmilesResponse,
)


def validate_smiles(smiles: str) -> ValidateSmilesResponse:
    if not smiles or not smiles.strip():
        return ValidateSmilesResponse(valid=False, error="empty_smiles")
    molecule = Chem.MolFromSmiles(smiles.strip())
    if molecule is None:
        return ValidateSmilesResponse(valid=False, error="rdkit_parse_failed")
    try:
        canonical = Chem.MolToSmiles(molecule, canonical=True)
    except Exception as exc:  # noqa: BLE001
        return ValidateSmilesResponse(valid=False, error=str(exc))
    return ValidateSmilesResponse(valid=True, canonical_smiles=canonical)


def _split_reaction(reaction_smiles: str) -> tuple[list[str], list[str], list[str]] | None:
    text = reaction_smiles.strip()
    if ">>" not in text:
        return None
    left, right = text.split(">>", 1)
    agents: list[str] = []
    if ">" in left:
        reactants_text, agents_text = left.split(">", 1)
        agents = [part.strip() for part in agents_text.split(".") if part.strip()]
    else:
        reactants_text = left
    reactants = [part.strip() for part in reactants_text.split(".") if part.strip()]
    products = [part.strip() for part in right.split(".") if part.strip()]
    if not reactants or not products:
        return None
    return reactants, agents, products


def validate_reaction_smiles(reaction_smiles: str) -> ValidateReactionResponse:
    if not reaction_smiles or not reaction_smiles.strip():
        return ValidateReactionResponse(valid=False, error="empty_reaction_smiles")

    parsed = _split_reaction(reaction_smiles)
    if parsed is None:
        return ValidateReactionResponse(valid=False, error="reaction_smiles_must_use_reactants_>>_products")

    reactants, _agents, products = parsed
    for smiles in [*reactants, *products]:
        result = validate_smiles(smiles)
        if not result.valid:
            return ValidateReactionResponse(valid=False, error=f"invalid_component:{smiles}")

    try:
        rxn = rdChemReactions.ReactionFromSmarts(reaction_smiles.strip(), useSmiles=True)
    except Exception as exc:  # noqa: BLE001
        return ValidateReactionResponse(valid=False, error=f"rdkit_reaction_parse_failed:{exc}")
    if rxn is None:
        return ValidateReactionResponse(valid=False, error="rdkit_reaction_parse_failed")

    try:
        canonical_parts = []
        for smiles in reactants:
            mol = Chem.MolFromSmiles(smiles)
            canonical_parts.append(Chem.MolToSmiles(mol, canonical=True))
        left = ".".join(canonical_parts)
        right = ".".join(
            Chem.MolToSmiles(Chem.MolFromSmiles(smiles), canonical=True) for smiles in products
        )
        canonical = f"{left}>>{right}"
    except Exception:
        canonical = reaction_smiles.strip()

    return ValidateReactionResponse(
        valid=True,
        canonical_reaction_smiles=canonical,
        reactant_count=len(reactants),
        product_count=len(products),
    )


def generate_rxn(reaction_smiles: str, output_path: str, reaction_name: str | None = None) -> GenerateRxnResponse:
    validation = validate_reaction_smiles(reaction_smiles)
    if not validation.valid:
        return GenerateRxnResponse(missing_reason="extraction_failed", error=validation.error)

    try:
        rxn = AllChem.ReactionFromSmarts(reaction_smiles.strip(), useSmiles=True)
        if rxn is None:
            raise ValueError("ReactionFromSmarts returned None")
        if reaction_name:
            rxn.SetProp("Name", reaction_name)
        block = rdChemReactions.ReactionToRxnBlock(rxn)
    except Exception as exc:  # noqa: BLE001
        return GenerateRxnResponse(missing_reason="extraction_failed", error=str(exc))

    dest = Path(output_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(block, encoding="utf-8")
    return GenerateRxnResponse(rxn_path=str(dest), rxn_text=block)


def _mol_png(smiles: str, width: int, height: int) -> str | None:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    image = Draw.MolToImage(mol, size=(width, height))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def depict(smiles: str | None, reaction_smiles: str | None, width: int = 420, height: int = 160) -> DepictResponse:
    parts = []
    if reaction_smiles:
        parsed = _split_reaction(reaction_smiles)
        if not parsed:
            return DepictResponse(error="invalid_reaction_smiles")
        reactants, _agents, products = parsed
        for role, group in (("reactant", reactants), ("product", products)):
            for item in group:
                encoded = _mol_png(item, max(120, width // 3), height)
                parts.append({"role": role, "smiles": item, "image_base64": encoded})
        return DepictResponse(parts=parts)

    if not smiles:
        return DepictResponse(error="smiles_required")
    encoded = _mol_png(smiles, width, height)
    if not encoded:
        return DepictResponse(error="rdkit_parse_failed")
    return DepictResponse(image_base64=encoded)
