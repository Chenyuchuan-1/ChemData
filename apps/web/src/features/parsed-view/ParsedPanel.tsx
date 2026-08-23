import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { assetUrl, type ParsedBlock } from "../../api/client";

type Tab = "markdown" | "chemistry" | "json";

export default function ParsedPanel({
  documentId,
  tab,
  onTab,
  markdown,
  blocks,
  onJump,
}: {
  documentId: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  markdown: string;
  blocks: ParsedBlock[];
  onJump: (page: number, bbox: number[]) => void;
}) {
  const reactions = blocks.filter((block) => /反应|reaction|scheme|yield|产率|>>|→/i.test(block.text ?? "") || ["image", "table", "equation"].includes(block.block_type));
  const groups = {
    分子: blocks.filter((block) => /mol|smiles|compound|化合物/i.test(block.text ?? "")),
    反应: reactions,
    表格: blocks.filter((block) => block.block_type === "table"),
    图片: blocks.filter((block) => ["image", "chart"].includes(block.block_type)),
    公式: blocks.filter((block) => ["equation", "equation_interline"].includes(block.block_type)),
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <div className="flex h-12 items-center gap-5 border-b border-zinc-200 px-4 text-sm">
        {(["markdown", "chemistry", "json"] as Tab[]).map((item) => (
          <button
            key={item}
            onClick={() => onTab(item)}
            className={tab === item ? "font-medium text-[var(--accent)]" : "text-zinc-500"}
          >
            {item === "markdown" ? "Markdown" : item === "chemistry" ? "化学元素" : "JSON"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
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
                  onClick={() => onJump(block.page_no, block.bbox_norm)}
                  className="block w-full rounded-lg border border-transparent px-3 py-2 text-left text-[13px] hover:border-zinc-200 hover:bg-zinc-50"
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
                      onClick={() => onJump(block.page_no, block.bbox_norm)}
                      className="w-full rounded-xl border border-zinc-200 px-3 py-3 text-left"
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
      </div>
    </section>
  );
}
