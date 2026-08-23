import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, Sparkles } from "lucide-react";
import {
  api,
  exportUrl,
  pdfUrl,
  type AgentEvent,
  type DocumentRecord,
  type ParsedBlock,
  type ParseProgress,
  type ReactionRecord,
  type TableRecord,
} from "../api/client";
import FileSidebar from "../features/documents/FileSidebar";
import ParseProgressBanner from "../features/documents/ParseProgress";
import PdfViewer from "../features/pdf-viewer/PdfViewer";
import ParsedPanel from "../features/parsed-view/ParsedPanel";
import AgentPanel from "../features/agent/AgentPanel";
import ReactionReview from "../features/reactions/ReactionReview";
import { hitField, type ExtractKind } from "../features/extract/ExtractedResults";

type RightMode = "parsed" | "agent" | "review";
type ParsedTab = "markdown" | "chemistry" | "json" | "extract";

export default function DocumentPage() {
  const { documentId = "" } = useParams();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [blocks, setBlocks] = useState<ParsedBlock[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [reactions, setReactions] = useState<ReactionRecord[]>([]);
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [extractKind, setExtractKind] = useState<ExtractKind>("reactions");
  const [selectedExtractId, setSelectedExtractId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [rightMode, setRightMode] = useState<RightMode>("parsed");
  const [tab, setTab] = useState<ParsedTab>("markdown");
  const [highlight, setHighlight] = useState<{ page_no: number; bbox: number[] } | null>(null);
  const [activeReaction, setActiveReaction] = useState<ReactionRecord | null>(null);
  const [includePending, setIncludePending] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null);
  const parsePollRef = useRef<number | null>(null);

  const stopParsePoll = () => {
    if (parsePollRef.current !== null) {
      window.clearInterval(parsePollRef.current);
      parsePollRef.current = null;
    }
  };

  const refreshDocument = async (id: string) => {
    const [list, detail, md, extracted, tableRows] = await Promise.all([
      api.listDocuments(),
      api.getDocument(id),
      api.markdown(id).catch(() => ({ markdown: "" })),
      api.reactions(id).catch(() => ({ reactions: [] })),
      api.tables(id).catch(() => ({ tables: [] })),
    ]);
    setDocuments(list.documents);
    setDocument(detail.document);
    setBlocks(detail.blocks);
    setMarkdown(md.markdown);
    setReactions(extracted.reactions);
    setTables(tableRows.tables);
    return detail.document;
  };

  const tickParseProgress = async (id: string) => {
    const progress = await api.parseProgress(id);
    setParseProgress(progress);
    setDocument(progress.document);
    setDocuments((current) => current.map((item) => (item.id === id ? progress.document : item)));
    if (progress.document.parse_status === "completed" || progress.document.parse_status === "failed") {
      stopParsePoll();
      await refreshDocument(id);
    }
    return progress;
  };

  const watchParse = (id: string) => {
    stopParsePoll();
    void tickParseProgress(id).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    parsePollRef.current = window.setInterval(() => {
      void tickParseProgress(id).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 2000);
  };

  const startParse = async (id: string) => {
    setError(null);
    const result = await api.parseDocument(id);
    setDocument(result.document);
    setDocuments((current) => current.map((item) => (item.id === id ? result.document : item)));
    watchParse(id);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await refreshDocument(documentId);
        if (cancelled) return;
        if (loaded.parse_status === "parsing") {
          watchParse(documentId);
          return;
        }
        const progress = await api.parseProgress(documentId).catch(() => null);
        if (cancelled || !progress) return;
        setParseProgress(progress);
        if (progress.large && loaded.parse_status === "uploaded") {
          await startParse(documentId);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      stopParsePoll();
    };
  }, [documentId]);

  const jump = (page: number, bbox: number[], blockId?: string) => {
    if (blockId) setSelectedBlockId(blockId);
    setHighlight({ page_no: page, bbox });
  };

  const selectReaction = (reaction: ReactionRecord) => {
    setSelectedExtractId(reaction.id);
    setExtractKind("reactions");
    setActiveReaction(reaction);
    jump(reaction.provenance.page_no ?? 1, reaction.provenance.bbox ?? [0.1, 0.1, 0.9, 0.9]);
  };

  const selectTable = (table: TableRecord) => {
    setSelectedExtractId(table.id);
    setExtractKind("tables");
    jump(Number(table.provenance.page_no ?? 1), table.provenance.bbox ?? [0.1, 0.1, 0.9, 0.9]);
  };

  const handlePdfClick = (page: number, x: number, y: number) => {
    const hit = hitField(page, x, y, blocks, reactions, tables);
    if (!hit) return;
    setHighlight({ page_no: hit.page, bbox: hit.bbox });
    if (hit.type === "block") {
      setSelectedBlockId(hit.id);
      return;
    }
    setSelectedExtractId(hit.id);
    if (hit.type === "reaction") {
      setExtractKind("reactions");
      const reaction = reactions.find((item) => item.id === hit.id);
      if (reaction) setActiveReaction(reaction);
    } else {
      setExtractKind("tables");
    }
    if (rightMode === "parsed") setTab("extract");
  };

  const startExtract = async (example: unknown, instruction: string) => {
    setRightMode("agent");
    setRunning(true);
    setEvents([]);
    const { run_id } = await api.startExtract(documentId, { example, instruction });
    const source = new EventSource(`/api/agent/runs/${run_id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AgentEvent;
      setEvents((current) => [...current, event]);
      if (event.type === "record_saved" || event.type === "agent_completed") {
        void api.reactions(documentId).then((result) => setReactions(result.reactions));
        void api.tables(documentId).then((result) => setTables(result.tables)).catch(() => undefined);
      }
      if (event.type === "agent_completed" || event.type === "agent_failed") {
        setRunning(false);
        source.close();
      }
    };
    source.onerror = () => {
      setRunning(false);
      source.close();
    };
  };

  const current = useMemo(() => documents.find((item) => item.id === documentId) ?? document, [documents, document, documentId]);
  const parsing = current?.parse_status === "parsing";

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-12 items-center gap-3 border-b border-zinc-200 px-4">
        <button className="flex items-center gap-1 text-sm text-zinc-500" onClick={() => navigate("/")}>
          <ArrowLeft size={16} /> 返回
        </button>
        <div className="truncate text-sm text-zinc-800">{current?.filename}</div>
        {current?.parse_error && !parsing && (
          <div className="max-w-md truncate text-xs text-amber-600">{current.parse_error}</div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm disabled:text-zinc-400"
            disabled={parsing}
            onClick={() => {
              void startParse(documentId).catch((err) => setError(err instanceof Error ? err.message : String(err)));
            }}
          >
            {parsing ? "解析中..." : current?.parse_status === "failed" ? "重新解析" : "开始解析"}
          </button>
          <div className="relative">
            <button className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm" onClick={() => setExportOpen((value) => !value)}>
              导出 <ChevronDown size={14} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-zinc-200 bg-white p-2 text-sm shadow-sm">
                <label className="mb-2 flex items-center gap-2 px-2 text-xs text-zinc-500">
                  <input type="checkbox" checked={includePending} onChange={(event) => setIncludePending(event.target.checked)} />
                  包含未审核数据
                </label>
                {(["json", "jsonl", "rxn"] as const).map((kind) => (
                  <a
                    key={kind}
                    href={exportUrl(documentId, kind, includePending)}
                    className="block rounded-md px-2 py-1.5 hover:bg-zinc-50"
                    onClick={() => setExportOpen(false)}
                  >
                    {kind.toUpperCase()}
                  </a>
                ))}
              </div>
            )}
          </div>
          <button
            className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
            onClick={() => setRightMode("agent")}
          >
            <Sparkles size={14} /> Agent
          </button>
        </div>
      </header>

      {parsing && parseProgress && <ParseProgressBanner progress={parseProgress} />}
      {error && <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <FileSidebar
          documents={documents}
          currentId={documentId}
          onSelect={(id) => navigate(`/document/${id}`)}
          onUpload={async (file) => {
            const result = await api.uploadDocument(file);
            navigate(`/document/${result.document.id}`);
          }}
          onDelete={async (id) => {
            await api.deleteDocument(id);
            const list = await api.listDocuments();
            setDocuments(list.documents);
            if (id === documentId) navigate(list.documents[0] ? `/document/${list.documents[0].id}` : "/");
          }}
          onReparse={(id) => {
            void startParse(id).catch((err) => setError(err instanceof Error ? err.message : String(err)));
          }}
        />

        <div className="flex min-w-0 flex-[48] ">
          <PdfViewer
            url={pdfUrl(documentId)}
            filename={current?.filename ?? ""}
            highlight={highlight}
            onPdfClick={handlePdfClick}
          />
        </div>

        <div className="flex min-w-0 flex-[42] flex-col border-l border-zinc-200">
          {rightMode !== "parsed" && (
            <div className="flex h-10 items-center justify-between border-b border-zinc-200 px-4 text-xs text-zinc-500">
              <button onClick={() => setRightMode("parsed")}>返回解析结果</button>
              {rightMode === "review" && <button onClick={() => setRightMode("agent")}>返回 Agent</button>}
            </div>
          )}
          {rightMode === "parsed" && (
            <ParsedPanel
              documentId={documentId}
              tab={tab}
              onTab={setTab}
              markdown={markdown}
              blocks={blocks}
              onJump={jump}
              reactions={reactions}
              tables={tables}
              extractKind={extractKind}
              onExtractKind={setExtractKind}
              selectedExtractId={selectedExtractId}
              selectedBlockId={selectedBlockId}
              onSelectReaction={selectReaction}
              onSelectTable={selectTable}
            />
          )}
          {rightMode === "agent" && (
            <AgentPanel
              documentId={documentId}
              events={events}
              running={running}
              reactions={reactions}
              tables={tables}
              extractKind={extractKind}
              onExtractKind={setExtractKind}
              selectedExtractId={selectedExtractId}
              onStart={startExtract}
              onSelect={selectReaction}
              onSelectTable={selectTable}
              onOpenReview={(reaction) => {
                selectReaction(reaction);
                setRightMode("review");
              }}
            />
          )}
          {rightMode === "review" && activeReaction && (
            <ReactionReview
              documentId={documentId}
              reaction={activeReaction}
              onChange={(reaction) => {
                setActiveReaction(reaction);
                setReactions((current) => current.map((item) => (item.id === reaction.id ? reaction : item)));
              }}
              onJump={jump}
            />
          )}
        </div>
      </div>
    </div>
  );
}
