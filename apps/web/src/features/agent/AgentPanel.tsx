import { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { DEFAULT_SCHEMA_TEXT, type AgentEvent, type ReactionRecord, type TableRecord } from "../../api/client";
import ExtractedResults, { type ExtractKind } from "../extract/ExtractedResults";

const STAGES = [
  { id: "read_document", label: "读取文档" },
  { id: "parse_layout", label: "解析版面" },
  { id: "locate_reactions", label: "定位反应" },
  { id: "structured_extract", label: "结构化抽取" },
  { id: "chemistry_validate", label: "化学校验" },
  { id: "deduplicate", label: "去重" },
  { id: "save_database", label: "保存数据库" },
];

export default function AgentPanel({
  documentId,
  events,
  running,
  reactions,
  tables,
  extractKind,
  onExtractKind,
  selectedExtractId,
  onStart,
  onSelect,
  onSelectTable,
  onOpenReview,
}: {
  documentId: string;
  events: AgentEvent[];
  running: boolean;
  reactions: ReactionRecord[];
  tables: TableRecord[];
  extractKind: ExtractKind;
  onExtractKind: (kind: ExtractKind) => void;
  selectedExtractId?: string | null;
  onStart: (example: unknown, instruction: string) => void;
  onSelect: (reaction: ReactionRecord) => void;
  onSelectTable: (table: TableRecord) => void;
  onOpenReview: (reaction: ReactionRecord) => void;
}) {
  const [schemaText, setSchemaText] = useState(DEFAULT_SCHEMA_TEXT);
  const [instruction, setInstruction] = useState("请按照上述 JSON 格式抽取当前 PDF 中所有报告的化学反应。");
  const [showDev, setShowDev] = useState(false);
  const latest = events.at(-1);
  const stage = latest?.stage;

  const stageState = (id: string) => {
    if (stage === "completed") return "done";
    const index = STAGES.findIndex((item) => item.id === id);
    const current = STAGES.findIndex((item) => item.id === stage);
    if (current > index) return "done";
    if (current === index || (running && current < 0 && id === "read_document")) return "active";
    return "todo";
  };

  const userEvents = useMemo(
    () => events.filter((event) => event.type !== "tool_finished" || !event.developer),
    [events],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-base font-medium">提取数据</h2>
        <p className="mt-1 text-[13px] text-zinc-500">告诉 Agent 你希望从当前文档中提取的数据格式。</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
          <CodeMirror value={schemaText} height="220px" extensions={[json()]} onChange={setSchemaText} />
        </div>
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          className="mt-3 h-16 w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none"
        />
        <button
          disabled={running}
          onClick={() => {
            try {
              onStart(JSON.parse(schemaText), instruction);
            } catch {
              alert("JSON 格式无效");
            }
          }}
          className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "正在抽取..." : "开始抽取"}
        </button>
      </div>

      <div className="border-b border-zinc-200 px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className={`h-2 w-2 rounded-full ${running ? "bg-[var(--accent)]" : "bg-zinc-300"}`} />
          {latest?.message || "等待开始"}
        </div>
        {typeof latest?.progress === "number" && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(latest.progress * 100)}%` }} />
          </div>
        )}
        <div className="mt-4 space-y-2">
          {STAGES.map((item) => {
            const state = stageState(item.id);
            return (
              <div key={item.id} className="flex items-center gap-2 text-[13px] text-zinc-600">
                <span
                  className={`timeline-dot ${
                    state === "done" ? "bg-emerald-500" : state === "active" ? "bg-[var(--accent)]" : "bg-zinc-200"
                  }`}
                />
                {item.label}
              </div>
            );
          })}
        </div>
        <div className="mt-4 space-y-1 text-[12px] text-zinc-500">
          {userEvents.slice(-8).map((event, index) => (
            <div key={`${event.type}-${index}`}>{event.message}</div>
          ))}
        </div>
        <button className="mt-3 text-xs text-zinc-400" onClick={() => setShowDev((value) => !value)}>
          开发者详情
        </button>
        {showDev && (
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-zinc-50 p-2 text-[11px] text-zinc-500">
            {JSON.stringify(events.slice(-12), null, 2)}
          </pre>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <ExtractedResults
          documentId={documentId}
          reactions={reactions}
          tables={tables}
          kind={extractKind}
          onKind={onExtractKind}
          selectedId={selectedExtractId}
          onSelectReaction={onSelect}
          onSelectTable={onSelectTable}
          onReview={onOpenReview}
        />
      </div>
    </div>
  );
}
