import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { assetUrl, type ParsedBlock, type ReactionRecord, type TableRecord } from "../../api/client";
import ExtractedResults, { type ExtractKind } from "../extract/ExtractedResults";

type Tab = "markdown" | "chemistry" | "json" | "extract";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "markdown", label: "Markdown" },
  { id: "chemistry", label: "化学元素" },
  { id: "json", label: "JSON" },
  { id: "extract", label: "Agent 抽取结果" },
];

export default function ParsedPanel({
  documentId,
  tab,
  onTab,
  markdown,
  blocks,
  onJump,
  reactions,
  tables,
  extractKind,
  onExtractKind,
  selectedExtractId,
  selectedBlockId,
  onSelectReaction,
  onSelectTable,
}: {
  documentId: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  markdown: string;
  blocks: ParsedBlock[];
  onJump: (page: number, bbox: number[], blockId?: string) => void;
  reactions: ReactionRecord[];
  tables: TableRecord[];
  extractKind: ExtractKind;
  onExtractKind: (kind: ExtractKind) => void;
  selectedExtractId?: string | null;
  selectedBlockId?: string | null;
  onSelectReaction: (reaction: ReactionRecord) => void;
  onSelectTable: (table: TableRecord) => void;
}) {
  const reactionBlocks = blocks.filter(
    (block) =>
      /反应|reaction|scheme|yield|产率|>>|→/i.test(block.text ?? "") || ["image", "table", "equation"].includes(block.block_type),
  );
  const groups = {
    分子: blocks.filter((block) => /mol|smiles|compound|化合物/i.test(block.text ?? "")),
    反应: reactionBlocks,
    表格: blocks.filter((block) => block.block_type === "table"),
    图片: blocks.filter((block) => ["image", "chart"].includes(block.block_type)),
    公式: blocks.filter((block) => ["equation", "equation_interline"].includes(block.block_type)),
  };

  useEffect(() => {
    if (!selectedBlockId) return;
    document.querySelector(`[data-block-id="${selectedBlockId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedBlockId, tab]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <div className="flex h-12 items-center gap-5 border-b border-zinc-200 px-4 text-sm">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => onTab(item.id)}
            className={tab === item.id ? "font-medium text-[var(--accent)]" : "text-zinc-500"}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={`min-h-0 flex-1 ${tab === "json" || tab === "extract" ? "overflow-hidden" : "overflow-auto"}`}>
        {tab === "markdown" && (
          <div className="prose prose-sm max-w-none px-5 py-4 text-[14px] leading-7 text-zinc-800">
            {markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {markdown}
              </ReactMarkdown>
            ) : (
              <p className="text-sm text-zinc-400">尚未解析。大文件会自动分块；也可点击顶部「开始解析」。</p>
            )}
            <div className="mt-6 space-y-2">
              {blocks.map((block) => (
                <button
                  key={block.id}
                  data-block-id={block.id}
                  onClick={() => onJump(block.page_no, block.bbox_norm, block.id)}
                  className={`block w-full rounded-lg border px-3 py-2 text-left text-[13px] ${
                    selectedBlockId === block.id
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <div className="mb-1 text-[11px] text-zinc-400">
                    P{block.page_no} · {block.block_type}
                  </div>
                  <div className="whitespace-pre-wrap text-zinc-700">{block.text || "[视觉块]"}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "chemistry" && (
          <div className="space-y-5 px-4 py-4">
            {Object.entries(groups).map(([label, items]) => (
              <div key={label}>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</div>
                {items.length === 0 && <div className="text-xs text-zinc-400">暂无</div>}
                <div className="space-y-2">
                  {items.map((block) => (
                    <button
                      key={block.id}
                      data-block-id={block.id}
                      onClick={() => onJump(block.page_no, block.bbox_norm, block.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left ${
                        selectedBlockId === block.id
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-zinc-200"
                      }`}
                    >
                      <div className="text-[11px] text-zinc-400">
                        Page {block.page_no} · {block.block_type}
                      </div>
                      <div className="mt-1 line-clamp-4 text-[13px] text-zinc-700">{block.text || "查看原文定位"}</div>
                      {block.image_path && (
                        <img
                          src={assetUrl(documentId, `mineru/${block.image_path}`)}
                          alt=""
                          className="mt-2 max-h-32 rounded-md border border-zinc-100"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "json" && (
          <CodeMirror
            value={JSON.stringify(blocks, null, 2)}
            height="100%"
            extensions={[json()]}
            editable={false}
            basicSetup={{ lineNumbers: true }}
          />
        )}

        {tab === "extract" && (
          <ExtractedResults
            documentId={documentId}
            reactions={reactions}
            tables={tables}
            kind={extractKind}
            onKind={onExtractKind}
            selectedId={selectedExtractId}
            onSelectReaction={onSelectReaction}
            onSelectTable={onSelectTable}
          />
        )}
      </div>
    </section>
  );
}
