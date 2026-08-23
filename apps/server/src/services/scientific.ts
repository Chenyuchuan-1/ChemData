import { config } from "../config.js";

async function scientificFetch<T>(pathname: string, body: unknown, timeoutMs = 600_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.scientificUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json()) as T & { detail?: unknown };
    if (!response.ok) {
      throw new Error(typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload));
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export interface ScientificParseResult {
  document_id: string;
  markdown_path?: string | null;
  content_list_path?: string | null;
  middle_json_path?: string | null;
  images_dir?: string | null;
  pages?: Array<Record<string, unknown>>;
  parser?: string;
  backend?: string | null;
  warnings?: string[];
}

export interface NormalizedBlock {
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

export const scientific = {
  health: async () => {
    const response = await fetch(`${config.scientificUrl}/health`);
    return response.json();
  },
  parse: (body: Record<string, unknown>) => scientificFetch<ScientificParseResult>("/parse", body, 3_600_000),
  planParse: (body: Record<string, unknown>) =>
    scientificFetch<{
      document_id: string;
      page_count: number;
      chunk_count: number;
      chunks: Array<{ chunk_id: string; start_page: number; end_page: number; status: string; page_count: number }>;
    }>("/parse/plan", body, 600_000),
  parseChunk: (body: Record<string, unknown>) => scientificFetch<Record<string, unknown>>("/parse/chunk", body, 1_800_000),
  mergeParse: (body: Record<string, unknown>) => scientificFetch<ScientificParseResult>("/parse/merge", body, 120_000),
  parseManifest: async (outputDir: string) => {
    const response = await fetch(`${config.scientificUrl}/parse/manifest?output_dir=${encodeURIComponent(outputDir)}`);
    return response.json();
  },
  materializeTable: (body: Record<string, unknown>) =>
    scientificFetch<Record<string, unknown>>("/tables/materialize", body, 120_000),
  normalizeBlocks: (body: Record<string, unknown>) =>
    scientificFetch<{ blocks: NormalizedBlock[] }>("/normalize-blocks", body),
  pdfInfo: (pdfPath: string) => scientificFetch<{ page_count: number; pages: Array<{ page_no: number; width: number; height: number }> }>("/pdf/info", { pdf_path: pdfPath }),
  renderPages: (body: Record<string, unknown>) =>
    scientificFetch<{ pages: Array<{ page_no: number; path: string; width: number; height: number }> }>("/pdf/render-pages", body),
  crop: (body: Record<string, unknown>) => scientificFetch<{ path: string }>("/pdf/crop", body),
  validateSmiles: (smiles: string) =>
    scientificFetch<{ valid: boolean; canonical_smiles: string | null; error?: string | null }>("/chemistry/validate-smiles", { smiles }),
  validateReaction: (reaction_smiles: string) =>
    scientificFetch<{
      valid: boolean;
      canonical_reaction_smiles: string | null;
      reactant_count?: number | null;
      product_count?: number | null;
      error?: string | null;
    }>("/chemistry/validate-reaction", { reaction_smiles }),
  atomMap: (reaction_smiles: string) =>
    scientificFetch<{
      atom_mapped_reaction_smiles: string | null;
      mapper: string;
      mapper_version?: string | null;
      missing_reason?: string | null;
      error?: string | null;
    }>("/chemistry/atom-map", { reaction_smiles }),
  generateRxn: (body: Record<string, unknown>) =>
    scientificFetch<{
      rxn_path: string | null;
      rxn_text?: string | null;
      missing_reason?: string | null;
      error?: string | null;
    }>("/chemistry/generate-rxn", body),
  depict: (body: Record<string, unknown>) =>
    scientificFetch<{ image_base64?: string | null; parts?: unknown[]; error?: string | null }>("/chemistry/depict", body),
};
