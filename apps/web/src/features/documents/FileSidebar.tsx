import { FilePlus, RefreshCw, Trash2 } from "lucide-react";
import type { DocumentRecord } from "../../api/client";

const statusLabel: Record<string, string> = {
  uploaded: "待解析",
  parsing: "解析中",
  completed: "已完成",
  failed: "失败",
  pending: "待解析",
};

export default function FileSidebar({
  documents,
  currentId,
  onSelect,
  onUpload,
  onDelete,
  onReparse,
}: {
  documents: DocumentRecord[];
  currentId: string;
  onSelect: (id: string) => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onReparse: (id: string) => void;
}) {
  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-medium text-zinc-800">当前项目</div>
        <label className="cursor-pointer rounded-md p-1 text-zinc-500 hover:bg-zinc-50">
          <FilePlus size={16} />
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
            }}
          />
        </label>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-3">
        {documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => onSelect(doc.id)}
            className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${
              doc.id === currentId ? "bg-[var(--accent-soft)]" : "hover:bg-zinc-50"
            }`}
          >
            <div className="truncate text-[13px] text-zinc-800">{doc.filename}</div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
              <span>{statusLabel[doc.parse_status] ?? doc.parse_status}</span>
              <span>{doc.page_count} 页</span>
            </div>
            {doc.id === currentId && (
              <div className="mt-2 flex gap-2 text-zinc-500">
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onReparse(doc.id);
                  }}
                  className="inline-flex items-center gap-1 text-[11px]"
                >
                  <RefreshCw size={11} /> 重新解析
                </span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(doc.id);
                  }}
                  className="inline-flex items-center gap-1 text-[11px]"
                >
                  <Trash2 size={11} /> 删除
                </span>
              </div>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}
