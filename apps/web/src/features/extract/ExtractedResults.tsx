import { useEffect, useRef, useState } from "react";
import { api, assetUrl, type ParsedBlock, type ReactionRecord, type TableRecord } from "../../api/client";

export type ExtractKind = "reactions" | "tables";

export type FieldHit = {
  type: "block" | "reaction" | "table";
  id: string;
  page: number;
  bbox: number[];
};

function containsPoint(bbox: number[] | undefined, x: number, y: number): boolean {
  if (!bbox || bbox.length < 4) return false;
  const left = Math.min(bbox[0], bbox[2]);
  const right = Math.max(bbox[0], bbox[2]);
  const top = Math.min(bbox[1], bbox[3]);
  const bottom = Math.max(bbox[1], bbox[3]);
  return x >= left && x <= right && y >= top && y <= bottom;
}

function areaOf(bbox: number[]): number {
  return Math.max(0, Math.abs(bbox[2] - bbox[0]) * Math.abs(bbox[3] - bbox[1]));
}

export function hitField(
  page: number,
  x: number,
  y: number,
  blocks: ParsedBlock[],
  reactions: ReactionRecord[],
  tables: TableRecord[],
): FieldHit | null {
  const candidates: Array<FieldHit & { area: number }> = [];
  const push = (hit: FieldHit) => {
    if (!containsPoint(hit.bbox, x, y)) return;
    candidates.push({ ...hit, area: areaOf(hit.bbox) });
  };
  for (const block of blocks) {
    if (block.page_no !== page) continue;
    const bbox = block.bbox_norm?.length === 4 ? block.bbox_norm : block.bbox;
    if (bbox?.length === 4) push({ type: "block", id: block.id, page, bbox });
  }
  for (const reaction of reactions) {
    if ((reaction.provenance.page_no ?? 0) !== page) continue;
    const bbox = reaction.provenance.bbox;
    if (bbox?.length === 4) push({ type: "reaction", id: reaction.id, page, bbox });
  }
  for (const table of tables) {
    if (Number(table.provenance.page_no ?? 0) !== page) continue;
    const bbox = Array.isArray(table.provenance.bbox) ? table.provenance.bbox : undefined;
    if (bbox?.length === 4) push({ type: "table", id: table.id, page, bbox });
  }
  if (candidates.length === 0) return null;
  const best = candidates.reduce((winner, item) => (item.area < winner.area ? item : winner));
  return { type: best.type, id: best.id, page: best.page, bbox: best.bbox };
}

function ReactionCard({
  reaction,
  index,
  selected,
  onSelect,
  onReview,
}: {
  reaction: ReactionRecord;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onReview?: () => void;
}) {
  const [depict, setDepict] = useState<Array<{ role: string; smiles: string; image_base64?: string | null }>>([]);
  const smiles = typeof reaction.payload.reaction_smiles === "string" ? reaction.payload.reaction_smiles : "";

  useEffect(() => {
    if (!smiles) {
      setDepict([]);
      return;
    }
    let cancelled = false;
    void api
      .depict({ reaction_smiles: smiles })
      .then((result) => {
        if (!cancelled) setDepict(result.parts ?? []);
      })
      .catch(() => {
        if (!cancelled) setDepict([]);
      });
    return () => {
      cancelled = true;
    };
  }, [smiles]);

  const reactants = depict.filter((item) => item.role === "reactant" && item.image_base64);
  const agents = depict.filter((item) => item.role === "agent" && item.image_base64);
  const products = depict.filter((item) => item.role === "product" && item.image_base64);
  const conditions = (reaction.payload.conditions ?? {}) as Record<string, unknown>;

  return (
    <button
      data-extract-id={reaction.id}
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left ${
        selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-zinc-200 hover:bg-zinc-50"
      }`}
    >
      <div className="flex items-center justify-between text-[12px] text-zinc-400">
        <span>反应 {String(index + 1).padStart(2, "0")}</span>
        <span>
          P{reaction.provenance.page_no ?? "-"} · {reaction.review_status}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[13px] text-zinc-700">
        {String(reaction.payload.reaction_text ?? "无反应描述")}
      </div>
      {smiles ? (
        <div className="mt-2 overflow-x-auto">
          {depict.length > 0 ? (
            <div className="flex items-center gap-2">
              {reactants.map((item) => (
                <img
                  key={`r-${item.smiles}`}
                  src={`data:image/png;base64,${item.image_base64}`}
                  alt={item.smiles}
                  title={item.smiles}
                  className="h-14 rounded bg-white"
                />
              ))}
              {agents.length > 0 && (
                <>
                  <span className="text-zinc-300">[</span>
                  {agents.map((item) => (
                    <img
                      key={`a-${item.smiles}`}
                      src={`data:image/png;base64,${item.image_base64}`}
                      alt={item.smiles}
                      title={item.smiles}
                      className="h-10 rounded bg-white"
                    />
                  ))}
                  <span className="text-zinc-300">]</span>
                </>
              )}
              <span className="text-zinc-400">→</span>
              {products.map((item) => (
                <img
                  key={`p-${item.smiles}`}
                  src={`data:image/png;base64,${item.image_base64}`}
                  alt={item.smiles}
                  title={item.smiles}
                  className="h-14 rounded bg-white"
                />
              ))}
            </div>
          ) : (
            <div className="font-mono text-[11px] text-zinc-500">{smiles}</div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-zinc-400">无 SMILES，无法绘制结构</div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
        <div>产率 {String(reaction.payload.yield_percent ?? "null")}</div>
        <div>温度 {conditions.temperature_c != null ? `${conditions.temperature_c} °C` : "null"}</div>
      </div>
      {onReview && (
        <div className="mt-2">
          <span
            role="button"
            tabIndex={0}
            className="text-[12px] text-zinc-500 hover:text-[var(--accent)]"
            onClick={(event) => {
              event.stopPropagation();
              onReview();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                onReview();
              }
            }}
          >
            编辑审核
          </span>
        </div>
      )}
    </button>
  );
}

export default function ExtractedResults({
  documentId,
  reactions,
  tables,
  kind,
  onKind,
  selectedId,
  onSelectReaction,
  onSelectTable,
  onReview,
}: {
  documentId: string;
  reactions: ReactionRecord[];
  tables: TableRecord[];
  kind: ExtractKind;
  onKind: (kind: ExtractKind) => void;
  selectedId?: string | null;
  onSelectReaction: (reaction: ReactionRecord) => void;
  onSelectTable: (table: TableRecord) => void;
  onReview?: (reaction: ReactionRecord) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-extract-id="${selectedId}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <div className="text-xs font-medium text-zinc-600">Agent 抽取结果</div>
        <div className="ml-auto flex rounded-lg border border-zinc-200 p-0.5 text-[11px]">
          {(["reactions", "tables"] as ExtractKind[]).map((item) => (
            <button
              key={item}
              onClick={() => onKind(item)}
              className={`rounded-md px-2 py-1 ${kind === item ? "bg-[var(--accent)] text-white" : "text-zinc-500"}`}
            >
              {item === "reactions" ? `化学反应 ${reactions.length}` : `表格 ${tables.length}`}
            </button>
          ))}
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3">
        {kind === "reactions" && reactions.length === 0 && (
          <div className="text-xs text-zinc-400">还没有反应记录。解析完成后在 Agent 里开始抽取。</div>
        )}
        {kind === "reactions" &&
          reactions.map((reaction, index) => (
            <ReactionCard
              key={reaction.id}
              reaction={reaction}
              index={index}
              selected={selectedId === reaction.id}
              onSelect={() => onSelectReaction(reaction)}
              onReview={onReview ? () => onReview(reaction) : undefined}
            />
          ))}
        {kind === "tables" && tables.length === 0 && <div className="text-xs text-zinc-400">还没有表格记录。</div>}
        {kind === "tables" &&
          tables.map((table) => {
            const title = String(table.payload.table_title ?? table.table_id);
            const image = typeof table.payload.source_image_path === "string" ? table.payload.source_image_path : "";
            return (
              <button
                key={table.id}
                data-extract-id={table.id}
                onClick={() => onSelectTable(table)}
                className={`w-full rounded-xl border p-3 text-left ${
                  selectedId === table.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                <div className="flex items-center justify-between text-[12px] text-zinc-400">
                  <span>{table.table_id}</span>
                  <span>P{String(table.provenance.page_no ?? "-")}</span>
                </div>
                <div className="mt-1 text-[13px] text-zinc-700">{title || "未命名表格"}</div>
                {table.payload.table_description != null && (
                  <div className="mt-1 line-clamp-2 text-[12px] text-zinc-500">{String(table.payload.table_description)}</div>
                )}
                {image && (
                  <img src={assetUrl(documentId, image)} alt="" className="mt-2 max-h-28 rounded-md border border-zinc-100" />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
