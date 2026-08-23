import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Link2, Image as ImageIcon } from "lucide-react";
import { api, type DocumentRecord } from "../api/client";

const examples = [
  { title: "化学研究论文", desc: "从反应路线与实验部分抽取转化" },
  { title: "催化反应论文", desc: "Scheme 多底物条目拆成独立记录" },
  { title: "材料科学论文", desc: "保留证据定位，不做常识补全" },
  { title: "实验报告", desc: "条件、产率与结构式分别校验" },
];

const statusLabel: Record<string, string> = {
  uploaded: "待解析",
  parsing: "解析中",
  completed: "已完成",
  failed: "失败",
  pending: "待解析",
};

function pickCurrentTask(documents: DocumentRecord[]): DocumentRecord | null {
  return documents.find((item) => item.parse_status === "parsing") ?? documents[0] ?? null;
}

export default function HomePage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  useEffect(() => {
    void api
      .listDocuments()
      .then((result) => setDocuments(result.documents))
      .catch(() => setDocuments([]));
  }, []);

  const currentTask = useMemo(() => pickCurrentTask(documents), [documents]);

  const openWorkbench = (id?: string) => {
    const target = id ?? currentTask?.id;
    if (target) navigate(`/document/${target}`);
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.uploadDocument(file);
      navigate(`/document/${result.document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-white">
      <header className="mx-auto flex h-16 w-[880px] max-w-[calc(100%-48px)] items-center justify-between">
        <div className="text-[15px] font-medium tracking-wide text-zinc-800">Chem PDF Agent</div>
        <div className="flex items-center gap-3">
          <div className="hidden text-sm text-zinc-400 sm:block">本地解析 · 可追溯抽取</div>
          <button
            type="button"
            disabled={!currentTask}
            onClick={() => openWorkbench()}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
          >
            当前任务 <ArrowRight size={14} />
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-[880px] max-w-[calc(100%-48px)] flex-col items-center pt-20">
        <h1 className="text-[40px] font-semibold tracking-tight text-zinc-900">智能解析</h1>
        <p className="mt-3 text-[16px] text-zinc-500">让科学文档成为可计算的数据</p>

        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void upload(event.dataTransfer.files[0]);
          }}
          className="mt-12 flex h-[260px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-200 text-[var(--accent)]">
            <FileText size={30} />
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white"
          >
            {busy ? "上传中..." : "上传文件"}
          </button>
          <p className="mt-3 text-sm text-zinc-400">仅支持 PDF。超过 24 页或 20MB 会自动分块解析</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </label>

        {currentTask && (
          <button
            type="button"
            onClick={() => openWorkbench(currentTask.id)}
            className="mt-5 flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-left hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <div className="min-w-0">
              <div className="text-xs text-zinc-400">当前任务 / 工作台</div>
              <div className="mt-1 truncate text-sm font-medium text-zinc-800">{currentTask.filename}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {statusLabel[currentTask.parse_status] ?? currentTask.parse_status}
                {currentTask.page_count ? ` · ${currentTask.page_count} 页` : ""}
                {currentTask.parse_error ? ` · ${currentTask.parse_error}` : ""}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm text-[var(--accent)]">
              进入工作台 <ArrowRight size={16} />
            </span>
          </button>
        )}

        {documents.length > 1 && (
          <div className="mt-4 w-full rounded-2xl border border-zinc-200 p-3">
            <div className="px-2 pb-2 text-xs text-zinc-400">已有文档</div>
            <div className="space-y-1">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => openWorkbench(doc.id)}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-zinc-50"
                >
                  <span className="truncate text-sm text-zinc-800">{doc.filename}</span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {statusLabel[doc.parse_status] ?? doc.parse_status} · {doc.page_count} 页
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

        <div className="mt-16 mb-20 grid w-full grid-cols-2 gap-4 md:grid-cols-4">
          {examples.map((item) => (
            <div key={item.title} className="rounded-xl border border-zinc-200 p-4">
              <div className="text-sm font-medium text-zinc-800">{item.title}</div>
              <div className="mt-2 text-xs leading-5 text-zinc-500">{item.desc}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
