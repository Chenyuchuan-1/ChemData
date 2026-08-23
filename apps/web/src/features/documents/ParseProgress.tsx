import type { ParseProgress } from "../../api/client";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function ParseProgressBanner({ progress }: { progress: ParseProgress }) {
  const total = progress.chunk_count;
  const done = progress.completed_chunks;
  const percent = total > 0 ? Math.round((done / total) * 100) : progress.document.parse_status === "parsing" ? 8 : 0;
  const current = progress.current_chunk;
  const pageLabel = current
    ? `第 ${current.start_page + 1}–${current.end_page + 1} 页`
    : progress.document.page_count
      ? `共 ${progress.document.page_count} 页`
      : "";

  return (
    <div className="border-b border-violet-100 bg-violet-50/80 px-4 py-2.5">
      <div className="flex items-center justify-between gap-4 text-xs text-violet-800">
        <div className="min-w-0 truncate">
          大文件分块解析
          {total > 0 ? ` · 已完成 ${done}/${total} 块` : " · 正在规划分块"}
          {current
            ? ` · 正在 ${current.chunk_id}（第 ${(progress.chunks.findIndex((item) => item.chunk_id === current.chunk_id) + 1) || done + 1}/${total} 块） ${pageLabel}`
            : pageLabel
              ? ` · ${pageLabel}`
              : ""}
          {progress.file_size_bytes > 0 ? ` · ${formatBytes(progress.file_size_bytes)}` : ""}
        </div>
        <div className="shrink-0 tabular-nums">{percent}%</div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-violet-100">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      {progress.message && (
        <div className="mt-1 truncate text-[11px] text-violet-600">{progress.message}</div>
      )}
      {progress.failed_chunks > 0 && (
        <div className="mt-1 text-[11px] text-amber-700">已跳过 {progress.failed_chunks} 个失败分块，其余块会继续合并</div>
      )}
    </div>
  );
}
