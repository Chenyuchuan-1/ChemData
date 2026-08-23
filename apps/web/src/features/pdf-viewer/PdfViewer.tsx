import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, Search } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface Highlight {
  page_no: number;
  bbox: number[];
}

async function loadPdfDocument(url: string, signal: AbortSignal): Promise<PDFDocumentProxy> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`PDF 加载失败（${response.status}）`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength < 8) {
    throw new Error("PDF 文件为空或被截断");
  }
  const task = pdfjs.getDocument({
    data,
    disableRange: true,
    disableStream: true,
    isOffscreenCanvasSupported: false,
    wasmUrl: "/pdfjs/wasm/",
    useWasm: true,
    useWorkerFetch: true,
  });
  signal.addEventListener("abort", () => void task.destroy(), { once: true });
  return task.promise;
}

export default function PdfViewer({
  url,
  filename,
  highlight,
  onPageChange,
  onPdfClick,
}: {
  url: string;
  filename: string;
  highlight?: Highlight | null;
  onPageChange?: (page: number, total: number) => void;
  onPdfClick?: (page: number, x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const onPdfClickRef = useRef(onPdfClick);
  onPdfClickRef.current = onPdfClick;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [query, setQuery] = useState("");
  const [fitWidth, setFitWidth] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hostWidth, setHostWidth] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPdf(null);
    setPage(1);
    setLoadError(null);
    setLoading(true);
    void loadPdfDocument(url, controller.signal)
      .then((doc) => {
        if (!controller.signal.aborted) setPdf(doc);
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const update = () => setHostWidth(host.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (highlight?.page_no) setPage(highlight.page_no);
  }, [highlight?.page_no]);

  useEffect(() => {
    if (!pdf || !containerRef.current) return;
    const host = containerRef.current;
    let disposed = false;
    let pageProxy: PDFPageProxy | null = null;

    const render = async () => {
      host.innerHTML = "";
      try {
        pageProxy = await pdf.getPage(page);
        if (disposed) return;
        const unscaled = pageProxy.getViewport({ scale: 1 });
        const available = Math.max((hostWidth || host.clientWidth) - 32, 240);
        const fitted = available / Math.max(unscaled.width, 1);
        const nextScale = fitWidth ? Math.min(2.4, Math.max(0.35, fitted)) : scale;
        const viewport = pageProxy.getViewport({ scale: nextScale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement("canvas");
        if (!canvas.getContext("2d")) throw new Error("无法创建画布");
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.className = "block rounded-md bg-white shadow-sm";
        const overlay = document.createElement("div");
        overlay.className = "absolute left-0 top-0";
        overlay.style.width = `${viewport.width}px`;
        overlay.style.height = `${viewport.height}px`;
        const wrap = document.createElement("div");
        wrap.className = "relative mx-auto cursor-crosshair";
        wrap.style.width = `${viewport.width}px`;
        wrap.append(canvas, overlay);
        wrap.addEventListener("click", (event) => {
          const rect = wrap.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const nx = (event.clientX - rect.left) / rect.width;
          const ny = (event.clientY - rect.top) / rect.height;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
          onPdfClickRef.current?.(page, nx, ny);
        });
        host.append(wrap);

        renderTaskRef.current?.cancel();
        const task = pageProxy.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          intent: "display",
        });
        renderTaskRef.current = task;
        await task.promise;
        if (disposed) return;

        if (highlight && highlight.page_no === page && highlight.bbox?.length === 4) {
          const [x1, y1, x2, y2] = highlight.bbox;
          const box = document.createElement("div");
          box.className = "bbox-highlight absolute rounded-sm";
          box.style.left = `${x1 * 100}%`;
          box.style.top = `${y1 * 100}%`;
          box.style.width = `${Math.max(0, x2 - x1) * 100}%`;
          box.style.height = `${Math.max(0, y2 - y1) * 100}%`;
          overlay.append(box);
          box.scrollIntoView({ block: "center", behavior: "smooth" });
        }

        if (query.trim()) {
          const text = await pageProxy.getTextContent();
          const needle = query.toLowerCase();
          for (const item of text.items) {
            if (!("str" in item) || !item.str.toLowerCase().includes(needle)) continue;
            const tx = pdfjs.Util.transform(viewport.transform, item.transform);
            const marker = document.createElement("div");
            marker.className = "absolute bg-yellow-200/50";
            marker.style.left = `${tx[4]}px`;
            marker.style.top = `${tx[5] - item.height * viewport.scale}px`;
            marker.style.width = `${item.width * viewport.scale}px`;
            marker.style.height = `${item.height * viewport.scale}px`;
            overlay.append(marker);
          }
        }

        onPageChange?.(page, pdf.numPages);
        if (!fitWidth) setScale(nextScale);
      } catch (error) {
        if (disposed) return;
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
        if (name === "RenderingCancelledException") return;
        const message = error instanceof Error ? error.message : String(error);
        const note = document.createElement("div");
        note.className = "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800";
        note.textContent = `第 ${page} 页渲染失败：${message}`;
        host.append(note);
      }
    };

    void render();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      pageProxy?.cleanup();
    };
  }, [pdf, page, scale, fitWidth, highlight, query, onPageChange, hostWidth]);

  const total = pdf?.numPages ?? 1;

  return (
    <section className="flex min-w-0 flex-1 flex-col border-r border-zinc-200 bg-[#fafafa]">
      <div className="flex h-12 items-center gap-3 border-b border-zinc-200 bg-white px-3 text-sm">
        <span className="max-w-[180px] truncate text-zinc-700">{filename}</span>
        {onPdfClick && <span className="text-[11px] text-zinc-400">点击原文定位字段</span>}
        <div className="ml-auto flex items-center gap-1 text-zinc-600">
          <button className="rounded p-1 hover:bg-zinc-50" onClick={() => setPage((value) => Math.max(1, value - 1))}>
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-16 text-center text-xs">
            {page} / {total}
          </span>
          <button className="rounded p-1 hover:bg-zinc-50" onClick={() => setPage((value) => Math.min(total, value + 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          className="rounded p-1 hover:bg-zinc-50"
          onClick={() => {
            setFitWidth(false);
            setScale((value) => Math.max(0.5, value - 0.1));
          }}
        >
          <Minus size={16} />
        </button>
        <span className="w-12 text-center text-xs text-zinc-500">{Math.round(scale * 100)}%</span>
        <button
          className="rounded p-1 hover:bg-zinc-50"
          onClick={() => {
            setFitWidth(false);
            setScale((value) => Math.min(2.4, value + 0.1));
          }}
        >
          <Plus size={16} />
        </button>
        <button className="rounded-md border border-zinc-200 px-2 py-1 text-xs" onClick={() => setFitWidth(true)}>
          适应宽度
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1.5 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            className="h-7 w-28 rounded-md border border-zinc-200 pl-6 pr-2 text-xs outline-none"
          />
        </div>
      </div>
      {loadError && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">{loadError}</div>
      )}
      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-zinc-400">
            正在加载 PDF…
          </div>
        )}
        {!loading && !pdf && !loadError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-zinc-400">
            没有可显示的 PDF
          </div>
        )}
        <div ref={containerRef} className="h-full overflow-auto p-4" />
      </div>
    </section>
  );
}
