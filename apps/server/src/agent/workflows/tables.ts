import { documentDir } from "../../config.js";
import { getDocumentOrThrow, listBlocks, listPageImages, type BlockRow } from "../../services/documents.js";
import { saveTable } from "../../services/tables.js";
import { scientific } from "../../services/scientific.js";
import { chatCompletions } from "../provider.js";
import { parseJsonLoose } from "../schema-parser.js";

function nextTableId(index: number): string {
  return `table_${String(index + 1).padStart(6, "0")}`;
}

function tableBlocks(blocks: BlockRow[]): BlockRow[] {
  return blocks.filter((block) => {
    if (block.block_type === "table") return true;
    const text = block.text ?? "";
    const html = typeof block.meta.table_body === "string" ? block.meta.table_body : "";
    return /<table[\s>]/i.test(text) || /<table[\s>]/i.test(html);
  });
}

async function titleFromLlm(block: BlockRow): Promise<{ title: string | null; description: string | null }> {
  try {
    const payload = await chatCompletions([
      {
        role: "system",
        content:
          "Extract table_title and table_description from the evidence only. Missing fields must be null. Return JSON only. Never invent units or values.",
      },
      {
        role: "user",
        content: `Evidence from page ${block.page_no}:\n${(block.text ?? "").slice(0, 1800)}\n\nReturn {"table_title": null, "table_description": null}`,
      },
    ]);
    const raw = parseJsonLoose(payload.choices?.[0]?.message?.content ?? "{}") as {
      table_title?: string | null;
      table_description?: string | null;
    };
    return {
      title: raw.table_title ?? null,
      description: raw.table_description ?? null,
    };
  } catch {
    const caption = (block.text ?? "").split("\n").find((line) => /表\s*\d+|table\s+\d+/i.test(line));
    return { title: caption ?? null, description: null };
  }
}

export async function extractTables(
  documentId: string,
  onProgress?: (message: string, extra?: Record<string, unknown>) => void,
): Promise<number> {
  const document = getDocumentOrThrow(documentId);
  const blocks = tableBlocks(listBlocks(documentId));
  let saved = 0;
  for (const [index, block] of blocks.entries()) {
    const tableId = nextTableId(index);
    onProgress?.(`正在物化表格 ${tableId}`, { page_no: block.page_no });
    const meta = await titleFromLlm(block);
    const html = (block.text ?? "").includes("<table")
      ? block.text
      : typeof block.meta.table_body === "string"
        ? block.meta.table_body
        : "";
    try {
      const materialized = await scientific.materializeTable({
        table_id: tableId,
        output_dir: documentDir(documentId),
        html: html ?? "",
        title: meta.title,
        description: meta.description,
        page_no: block.page_no,
        bbox_norm: block.bbox_norm,
        pdf_path: document.file_path,
        page_image_path: listPageImages(documentId).find((item) => item.page_no === block.page_no)?.path,
      });
      saveTable({
        documentId,
        tableId,
        payload: {
          table_id: tableId,
          table_path: materialized.table_path,
          table_title: meta.title,
          table_description: meta.description,
          source_image_path: materialized.source_image_path,
        },
        provenance: {
          page_no: block.page_no,
          bbox: block.bbox_norm,
          source_type: "table",
          source_text: (block.text ?? "").slice(0, 1200),
          source_image_path: materialized.source_image_path,
          block_id: block.id,
        },
        validation: {
          schema_valid: true,
          schema_version: "table.v1",
          row_count: materialized.row_count ?? 0,
          columns: materialized.columns ?? [],
          missing: [
            ...(meta.title ? [] : [{ field: "table_title", missing_reason: "source_not_present" }]),
            ...(meta.description ? [] : [{ field: "table_description", missing_reason: "source_not_present" }]),
          ],
        },
      });
      saved += 1;
    } catch (error) {
      onProgress?.(`表格 ${tableId} 失败，已跳过：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return saved;
}
