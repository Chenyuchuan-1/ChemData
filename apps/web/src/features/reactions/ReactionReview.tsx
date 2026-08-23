import { useEffect, useState } from "react";
import { api, assetUrl, type ReactionRecord } from "../../api/client";

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-zinc-400">{label}</div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-16 w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-[13px] outline-none"
      />
    </label>
  );
}

export default function ReactionReview({
  documentId,
  reaction,
  onChange,
  onJump,
}: {
  documentId: string;
  reaction: ReactionRecord;
  onChange: (reaction: ReactionRecord) => void;
  onJump: (page: number, bbox: number[]) => void;
}) {
  const [draft, setDraft] = useState(reaction.payload);
  const [depict, setDepict] = useState<Array<{ role: string; smiles: string; image_base64?: string | null }>>([]);
  const conditions = (draft.conditions ?? {}) as Record<string, unknown>;

  useEffect(() => {
    setDraft(reaction.payload);
    const smiles = reaction.payload.reaction_smiles;
    if (typeof smiles === "string" && smiles) {
      void api.depict({ reaction_smiles: smiles }).then((result) => setDepict(result.parts ?? []));
    } else {
      setDepict([]);
    }
  }, [reaction]);

  const setField = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async (status?: ReactionRecord["review_status"]) => {
    const updated = await api.updateReaction(reaction.id, {
      payload: normalizeDraft(draft),
      review_status: status,
    });
    onChange(updated.reaction);
  };

  return (
    <div className="flex h-full flex-col overflow-auto px-5 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">人工审核</h2>
        <button
          className="text-sm text-[var(--accent)]"
          onClick={() => onJump(reaction.provenance.page_no ?? 1, reaction.provenance.bbox ?? [0, 0, 1, 1])}
        >
          查看原文
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 p-3 text-[13px] text-zinc-600">
        <div className="text-[11px] text-zinc-400">原文证据</div>
        <p className="mt-2 whitespace-pre-wrap">{reaction.provenance.source_text || "无文本证据"}</p>
        {reaction.provenance.source_image_path && (
          <img
            src={assetUrl(documentId, reaction.provenance.source_image_path)}
            alt=""
            className="mt-3 max-h-40 rounded-md border border-zinc-100"
          />
        )}
      </div>

      {depict.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-zinc-400">结构式</div>
          <div className="mt-2 flex items-center gap-2 overflow-auto">
            {depict
              .filter((item) => item.role === "reactant")
              .map((item) => (
                <img key={item.smiles} src={`data:image/png;base64,${item.image_base64}`} alt={item.smiles} className="h-20" />
              ))}
            <span className="text-zinc-400">→</span>
            {depict
              .filter((item) => item.role === "product")
              .map((item) => (
                <img key={item.smiles} src={`data:image/png;base64,${item.image_base64}`} alt={item.smiles} className="h-20" />
              ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <Field label="Reaction Text" value={String(draft.reaction_text ?? "")} onChange={(value) => setField("reaction_text", emptyToNull(value))} />
        <Field label="Reaction SMILES" value={String(draft.reaction_smiles ?? "")} onChange={(value) => setField("reaction_smiles", emptyToNull(value))} />
        <Field label="Atom-mapped SMILES" value={String(draft.atom_mapped_reaction_smiles ?? "")} onChange={(value) => setField("atom_mapped_reaction_smiles", emptyToNull(value))} />
        <Field label="LaTeX" value={String(draft.reaction_latex ?? "")} onChange={(value) => setField("reaction_latex", emptyToNull(value))} />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Catalyst"
            value={String(conditions.catalyst ?? "")}
            onChange={(value) => setField("conditions", { ...conditions, catalyst: emptyToNull(value) })}
          />
          <Field
            label="Solvent"
            value={String(conditions.solvent ?? "")}
            onChange={(value) => setField("conditions", { ...conditions, solvent: emptyToNull(value) })}
          />
          <Field
            label="Temperature"
            value={String(conditions.temperature_c ?? "")}
            onChange={(value) => setField("conditions", { ...conditions, temperature_c: numberOrNull(value) })}
          />
          <Field
            label="Time"
            value={String(conditions.time_h ?? "")}
            onChange={(value) => setField("conditions", { ...conditions, time_h: numberOrNull(value) })}
          />
        </div>
        <Field label="Yield" value={String(draft.yield_percent ?? "")} onChange={(value) => setField("yield_percent", numberOrNull(value))} />
      </div>

      <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-[12px] text-zinc-500">
        <div className="mb-1 text-[11px] text-zinc-400">Validation</div>
        <pre className="whitespace-pre-wrap">{JSON.stringify(reaction.validation, null, 2)}</pre>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 pb-6">
        <button className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white" onClick={() => void save("approved")}>
          确认
        </button>
        <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm" onClick={() => void save("edited")}>
          修改后确认
        </button>
        <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm" onClick={() => void save("uncertain")}>
          存疑
        </button>
        <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-red-500" onClick={() => void api.rejectReaction(reaction.id).then((result) => onChange(result.reaction))}>
          驳回
        </button>
      </div>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeDraft(draft: Record<string, unknown>): Record<string, unknown> {
  return {
    ...draft,
    reaction_text: emptyToNull(String(draft.reaction_text ?? "")),
    reaction_smiles: emptyToNull(String(draft.reaction_smiles ?? "")),
    atom_mapped_reaction_smiles: emptyToNull(String(draft.atom_mapped_reaction_smiles ?? "")),
    reaction_latex: emptyToNull(String(draft.reaction_latex ?? "")),
    yield_percent: draft.yield_percent === "" ? null : draft.yield_percent,
  };
}
