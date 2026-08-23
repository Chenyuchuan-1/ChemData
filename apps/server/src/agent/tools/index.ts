import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { documentDir } from "../../config.js";
import { getDocumentOrThrow, listBlocks, listPageImages, searchBlocks } from "../../services/documents.js";
import { findDuplicate, getReactionOrThrow, saveReaction, updateReaction } from "../../services/reactions.js";
import { scientific } from "../../services/scientific.js";
import type { InferredSchema } from "../schema-parser.js";
import { validateAgainstSchema } from "../schema-parser.js";

export interface ToolContext {
  documentId: string;
  schema: InferredSchema;
  onProgress?: (message: string, extra?: Record<string, unknown>) => void;
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function pageImage(documentId: string, pageNo: number): string | undefined {
  return listPageImages(documentId).find((item) => item.page_no === pageNo)?.path;
}

export function createDocumentTools(ctx: ToolContext): AgentTool[] {
  const get_document: AgentTool = {
    name: "get_document",
    label: "Get document",
    description: "Get basic metadata for the currently selected PDF.",
    parameters: Type.Object({}),
    execute: async () => {
      const document = getDocumentOrThrow(ctx.documentId);
      return ok({
        id: document.id,
        filename: document.filename,
        page_count: document.page_count,
        parse_status: document.parse_status,
        parse_error: document.parse_error,
      });
    },
  };

  const list_pages: AgentTool = {
    name: "list_pages",
    label: "List pages",
    description: "List all pages of the current PDF.",
    parameters: Type.Object({}),
    execute: async () => {
      const document = getDocumentOrThrow(ctx.documentId);
      const images = listPageImages(ctx.documentId);
      return ok({
        page_count: document.page_count,
        pages: Array.from({ length: document.page_count }, (_, index) => ({
          page_no: index + 1,
          image_path: images.find((item) => item.page_no === index + 1)?.path ?? null,
        })),
      });
    },
  };

  const get_page_blocks: AgentTool = {
    name: "get_page_blocks",
    label: "Get page blocks",
    description: "Read MinerU blocks for one page. page_no is 1-based.",
    parameters: Type.Object({
      page_no: Type.Integer({ minimum: 1, description: "1-based page number" }),
    }),
    execute: async (_id, args) => {
      const pageNo = Number((args as { page_no: number }).page_no);
      const blocks = listBlocks(ctx.documentId, pageNo).map((block) => ({
        id: block.id,
        page_no: block.page_no,
        block_type: block.block_type,
        text: block.text,
        bbox: block.bbox_norm,
        image_path: block.image_path,
        reading_order: block.reading_order,
      }));
      return ok({ page_no: pageNo, blocks });
    },
  };

  const search_document: AgentTool = {
    name: "search_document",
    label: "Search document",
    description: "Search parsed blocks. Use only as an aid; never replace full-page scanning.",
    parameters: Type.Object({
      query: Type.String({ description: "Plain text query" }),
    }),
    execute: async (_id, args) => {
      const query = String((args as { query: string }).query);
      const hits = searchBlocks(ctx.documentId, query).map((block) => ({
        page: block.page_no,
        block: block.id,
        text: block.text,
        bbox: block.bbox_norm,
        block_type: block.block_type,
      }));
      return ok({ query, hits });
    },
  };

  const get_page_image: AgentTool = {
    name: "get_page_image",
    label: "Get page image",
    description: "Get the rendered full-page image path for a page.",
    parameters: Type.Object({
      page_no: Type.Integer({ minimum: 1 }),
    }),
    execute: async (_id, args) => {
      const pageNo = Number((args as { page_no: number }).page_no);
      let image = pageImage(ctx.documentId, pageNo);
      if (!image) {
        const document = getDocumentOrThrow(ctx.documentId);
        await scientific.renderPages({
          pdf_path: document.file_path,
          output_dir: path.join(documentDir(ctx.documentId), "pages"),
          dpi: 144,
          start_page: pageNo - 1,
          end_page: pageNo - 1,
        });
        image = pageImage(ctx.documentId, pageNo);
      }
      return ok({ page_no: pageNo, image_path: image ?? null });
    },
  };

  const get_crop: AgentTool = {
    name: "get_crop",
    label: "Get crop",
    description: "Crop a page region using a normalized bbox [x1,y1,x2,y2] in 0-1.",
    parameters: Type.Object({
      page_no: Type.Integer({ minimum: 1 }),
      bbox: Type.Array(Type.Number(), { minItems: 4, maxItems: 4 }),
    }),
    execute: async (_id, args) => {
      const { page_no, bbox } = args as { page_no: number; bbox: number[] };
      const document = getDocumentOrThrow(ctx.documentId);
      const dest = path.join(documentDir(ctx.documentId), "crops", `agent_${page_no}_${Date.now()}.png`);
      const result = await scientific.crop({
        pdf_path: document.file_path,
        page_image_path: pageImage(ctx.documentId, page_no),
        page_no,
        bbox_norm: bbox,
        output_path: dest,
      });
      return ok({ page_no, bbox, image_path: result.path });
    },
  };

  const list_figures: AgentTool = {
    name: "list_figures",
    label: "List figures",
    description: "List MinerU image / figure / table visual blocks.",
    parameters: Type.Object({}),
    execute: async () => {
      const figures = listBlocks(ctx.documentId).filter((block) =>
        ["image", "table", "chart", "figure"].includes(block.block_type),
      );
      return ok(
        figures.map((block) => ({
          id: block.id,
          page_no: block.page_no,
          block_type: block.block_type,
          text: block.text,
          bbox: block.bbox_norm,
          image_path: block.image_path,
        })),
      );
    },
  };

  const validate_smiles: AgentTool = {
    name: "validate_smiles",
    label: "Validate SMILES",
    description: "Validate a molecule SMILES with RDKit.",
    parameters: Type.Object({
      smiles: Type.String(),
    }),
    execute: async (_id, args) => ok(await scientific.validateSmiles(String((args as { smiles: string }).smiles))),
  };

  const validate_reaction_smiles: AgentTool = {
    name: "validate_reaction_smiles",
    label: "Validate reaction SMILES",
    description: "Check whether reactants>>products can be parsed by RDKit.",
    parameters: Type.Object({
      reaction_smiles: Type.String(),
    }),
    execute: async (_id, args) =>
      ok(await scientific.validateReaction(String((args as { reaction_smiles: string }).reaction_smiles))),
  };

  const atom_map_reaction: AgentTool = {
    name: "atom_map_reaction",
    label: "Atom map reaction",
    description: "Generate atom-mapped reaction SMILES with the configured mapper. Never invent mapping.",
    parameters: Type.Object({
      reaction_smiles: Type.String(),
    }),
    execute: async (_id, args) => ok(await scientific.atomMap(String((args as { reaction_smiles: string }).reaction_smiles))),
  };

  const generate_rxn: AgentTool = {
    name: "generate_rxn",
    label: "Generate RXN",
    description: "Write a validated reaction to an RXN file.",
    parameters: Type.Object({
      reaction_smiles: Type.String(),
      filename: Type.Optional(Type.String()),
    }),
    execute: async (_id, args) => {
      const { reaction_smiles, filename } = args as { reaction_smiles: string; filename?: string };
      const dest = path.join(
        documentDir(ctx.documentId),
        "reactions",
        filename || `reaction_${Date.now()}.rxn`,
      );
      const result = await scientific.generateRxn({
        reaction_smiles,
        output_path: dest,
      });
      if (result.rxn_path) {
        const relative = path.relative(documentDir(ctx.documentId), result.rxn_path);
        return ok({ ...result, rxn_path: relative });
      }
      return ok(result);
    },
  };

  const save_reaction: AgentTool = {
    name: "save_reaction",
    label: "Save reaction",
    description: "Save one extracted reaction candidate. Payload must match the user schema. Provenance is required.",
    parameters: Type.Object({
      payload: Type.Object({}, { additionalProperties: true }),
      provenance: Type.Object(
        {
          page_no: Type.Integer(),
          bbox: Type.Array(Type.Number()),
          source_type: Type.Optional(Type.String()),
          source_text: Type.Optional(Type.String()),
          source_image_path: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    }),
    execute: async (_id, args) => {
      const { payload, provenance } = args as {
        payload: Record<string, unknown>;
        provenance: Record<string, unknown>;
      };
      const checked = validateAgainstSchema(ctx.schema, payload);
      if (!checked.valid) {
        return ok({ saved: false, validation_failed: true, errors: checked.errors });
      }
      const duplicate = findDuplicate(ctx.documentId, checked.value as Record<string, unknown>, provenance);
      if (duplicate) {
        return ok({ saved: false, duplicate_of: duplicate.id });
      }
      const record = saveReaction({
        documentId: ctx.documentId,
        payload: checked.value as Record<string, unknown>,
        provenance,
        validation: {
          schema_valid: true,
          missing: checked.missing,
        },
      });
      ctx.onProgress?.("record_saved", { reaction_id: record.id });
      return ok({ saved: true, id: record.id, review_status: record.review_status });
    },
  };

  const update_reaction: AgentTool = {
    name: "update_reaction",
    label: "Update reaction",
    description: "Update a previously saved candidate reaction.",
    parameters: Type.Object({
      reaction_id: Type.String(),
      payload: Type.Optional(Type.Object({}, { additionalProperties: true })),
      provenance: Type.Optional(Type.Object({}, { additionalProperties: true })),
    }),
    execute: async (_id, args) => {
      const { reaction_id, payload, provenance } = args as {
        reaction_id: string;
        payload?: Record<string, unknown>;
        provenance?: Record<string, unknown>;
      };
      const current = getReactionOrThrow(reaction_id);
      const nextPayload = payload ? validateAgainstSchema(ctx.schema, payload) : null;
      if (nextPayload && !nextPayload.valid) {
        return ok({ updated: false, validation_failed: true, errors: nextPayload.errors });
      }
      const record = updateReaction(reaction_id, {
        payload: (nextPayload?.value as Record<string, unknown> | undefined) ?? current.payload,
        provenance: provenance ?? current.provenance,
        review_status: "pending",
      });
      return ok({ updated: true, id: record.id });
    },
  };

  return [
    get_document,
    list_pages,
    get_page_blocks,
    search_document,
    get_page_image,
    get_crop,
    list_figures,
    validate_smiles,
    validate_reaction_smiles,
    atom_map_reaction,
    generate_rxn,
    save_reaction,
    update_reaction,
  ];
}

export function readLocalFileIfExists(filePath: string | null | undefined): Buffer | null {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}
