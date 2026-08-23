export interface DocumentRecord {
  id: string;
  filename: string;
  file_path: string;
  sha256: string;
  page_count: number;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedBlock {
  id: string;
  document_id: string;
  page_no: number;
  block_type: string;
  text: string | null;
  bbox: number[];
  bbox_norm: number[];
  image_path: string | null;
  reading_order: number;
  meta: Record<string, unknown>;
}

export interface TableRecord {
  id: string;
  document_id: string;
  table_id: string;
  payload: Record<string, unknown>;
  provenance: {
    page_no?: number;
    bbox?: number[];
    source_type?: string;
    source_text?: string;
    source_image_path?: string | null;
  };
  validation: Record<string, unknown>;
  review_status: string;
  created_at: string;
  updated_at: string;
}

export interface ReactionRecord {
  id: string;
  document_id: string;
  payload: Record<string, unknown>;
  provenance: {
    page_no?: number;
    bbox?: number[];
    source_type?: string;
    source_text?: string;
    source_image_path?: string | null;
    entry_label?: string | null;
  };
  validation: Record<string, unknown>;
  review_status: "pending" | "approved" | "edited" | "uncertain" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface AgentEvent {
  type: string;
  run_id: string;
  stage?: string;
  message?: string;
  progress?: number;
  [key: string]: unknown;
}

export interface ParseChunkProgress {
  chunk_id: string;
  start_page: number;
  end_page: number;
  page_count: number;
  status: string;
  error?: string | null;
}

export interface ParseProgress {
  document: DocumentRecord;
  running: boolean;
  large: boolean;
  chunked: boolean;
  file_size_bytes: number;
  chunk_count: number;
  completed_chunks: number;
  failed_chunks: number;
  current_chunk: ParseChunkProgress | null;
  chunks: ParseChunkProgress[];
  message: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json();
      detail = payload.message || payload.error || JSON.stringify(payload);
    } catch {
      detail = await response.text();
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  listDocuments: () => request<{ documents: DocumentRecord[] }>("/api/documents"),
  getDocument: (id: string) => request<{ document: DocumentRecord; blocks: ParsedBlock[] }>(`/api/documents/${id}`),
  uploadDocument: async (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<{ document: DocumentRecord; auto_parse?: boolean; chunked?: boolean }>("/api/documents", {
      method: "POST",
      body: data,
    });
  },
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  parseDocument: (id: string, body?: { start_page?: number; end_page?: number }) =>
    request<{ accepted?: boolean; document: DocumentRecord; blocks: ParsedBlock[]; chunked?: boolean }>(
      `/api/documents/${id}/parse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      },
    ),
  parseProgress: (id: string) => request<ParseProgress>(`/api/documents/${id}/parse-progress`),
  markdown: (id: string) => request<{ markdown: string }>(`/api/documents/${id}/markdown`),
  blocks: (id: string) => request<{ blocks: ParsedBlock[] }>(`/api/documents/${id}/blocks`),
  reactions: (id: string) => request<{ reactions: ReactionRecord[] }>(`/api/documents/${id}/reactions`),
  tables: (id: string) => request<{ tables: TableRecord[] }>(`/api/documents/${id}/tables`),
  updateReaction: (id: string, body: Record<string, unknown>) =>
    request<{ reaction: ReactionRecord }>(`/api/reactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  approveReaction: (id: string) =>
    request<{ reaction: ReactionRecord }>(`/api/reactions/${id}/approve`, { method: "POST" }),
  rejectReaction: (id: string, status?: string) =>
    request<{ reaction: ReactionRecord }>(`/api/reactions/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
  startExtract: (id: string, body: Record<string, unknown>) =>
    request<{ run_id: string }>(`/api/documents/${id}/agent/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  getRun: (runId: string) => request<{ run: Record<string, unknown>; events: AgentEvent[] }>(`/api/agent/runs/${runId}`),
  depict: (body: Record<string, unknown>) => request<{ image_base64?: string | null; parts?: Array<{ role: string; smiles: string; image_base64?: string | null }> }>("/api/chemistry/depict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
};

export function pdfUrl(documentId: string): string {
  return `/api/documents/${documentId}/pdf`;
}

export function assetUrl(documentId: string, relative: string): string {
  return `/api/documents/${documentId}/assets/${relative.replace(/^\/+/, "")}`;
}

export function exportUrl(documentId: string, kind: "json" | "jsonl" | "rxn", includePending: boolean): string {
  const suffix = kind === "rxn" ? "reactions.rxn" : `reactions.${kind}`;
  return `/api/documents/${documentId}/export/${suffix}?include_pending=${includePending ? "true" : "false"}`;
}

export const DEFAULT_SCHEMA_TEXT = `{
  "reaction_text": "",
  "reaction_smiles": "",
  "atom_mapped_reaction_smiles": null,
  "reaction_latex": "",
  "rxn_path": "",
  "conditions": {
    "catalyst": null,
    "temperature_c": null,
    "time_h": null
  },
  "yield_percent": null
}`;
