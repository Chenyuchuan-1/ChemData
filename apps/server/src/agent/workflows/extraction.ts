import path from "node:path";
import { documentDir } from "../../config.js";
import { getDocumentOrThrow, listBlocks, listPageImages, type BlockRow } from "../../services/documents.js";
import {
  findDuplicate,
  listReactions,
  saveReaction,
  type ReactionRecord,
} from "../../services/reactions.js";
import { scientific } from "../../services/scientific.js";
import { createDocumentAgent } from "../create-agent.js";
import { chatCompletions, analyzeReactionImage } from "../provider.js";
import {
  parseExampleToSchema,
  parseJsonLoose,
  validateAgainstSchema,
  type InferredSchema,
} from "../schema-parser.js";
import { createRun, finishRun, runHub, type AgentEvent } from "../runs.js";
import { writeReviewJson } from "../../services/review.js";
import { extractTables } from "./tables.js";

const REACTION_HINT =
  /(反应|催化|酯化|萃取|scheme|reaction|yield|产率|catalyst|smiles|→|->|>>|℃|°c|substrate|reagent|afford|product \d)/i;
const ENTRY_PATTERN = /(?<![A-Za-z0-9])(\d+\s*[a-z])\s+(\d{1,3}(?:\.\d+)?)\s*%/gi;

export interface ExtractOptions {
  documentId: string;
  example: unknown;
  instruction?: string;
}

interface Candidate {
  page_no: number;
  bbox: number[];
  source_type: string;
  source_text: string;
  block_ids: string[];
  image_path?: string | null;
  entry_label?: string;
  yield_percent?: number | null;
  inherited_conditions?: Record<string, unknown>;
}

function emit(runId: string, event: Omit<AgentEvent, "run_id">) {
  runHub.emit({ run_id: runId, ...event });
}

function unionBbox(blocks: BlockRow[]): number[] {
  if (!blocks.length) return [0.1, 0.1, 0.9, 0.9];
  const xs1 = blocks.map((block) => block.bbox_norm[0] ?? 0);
  const ys1 = blocks.map((block) => block.bbox_norm[1] ?? 0);
  const xs2 = blocks.map((block) => block.bbox_norm[2] ?? 1);
  const ys2 = blocks.map((block) => block.bbox_norm[3] ?? 1);
  return [Math.min(...xs1), Math.min(...ys1), Math.max(...xs2), Math.max(...ys2)];
}

function discoverCandidates(blocks: BlockRow[]): Candidate[] {
  const byPage = new Map<number, BlockRow[]>();
  for (const block of blocks) {
    const list = byPage.get(block.page_no) ?? [];
    list.push(block);
    byPage.set(block.page_no, list);
  }

  const candidates: Candidate[] = [];
  for (const [pageNo, pageBlocks] of byPage) {
    const pageText = pageBlocks.map((block) => block.text ?? "").join("\n");
    const interesting = pageBlocks.filter((block) => {
      const text = block.text ?? "";
      return REACTION_HINT.test(text) || ["image", "table", "chart", "equation"].includes(block.block_type);
    });
    if (!interesting.length && !REACTION_HINT.test(pageText)) continue;

    const conditionMatch = pageText.match(
      /(?:general conditions?|一般条件|反应条件)[:：]?\s*([^\n]{8,180})/i,
    );
    const inherited: Record<string, unknown> = {};
    if (conditionMatch) {
      const blob = conditionMatch[1];
      const catalyst = blob.match(/\b([A-Z][A-Za-z0-9()[\]]{1,24})\b/);
      const temperature = blob.match(/(\d+(?:\.\d+)?)\s*(?:°c|℃|c\b)/i);
      const time = blob.match(/(\d+(?:\.\d+)?)\s*h\b/i);
      if (catalyst) inherited.catalyst = catalyst[1];
      if (temperature) inherited.temperature_c = Number(temperature[1]);
      if (time) inherited.time_h = Number(time[1]);
    }

    const entries = [...pageText.matchAll(ENTRY_PATTERN)];
    if (entries.length >= 2) {
      for (const match of entries) {
        const label = match[1].replace(/\s+/g, "");
        const nearby = interesting.length ? interesting : pageBlocks.slice(0, 4);
        candidates.push({
          page_no: pageNo,
          bbox: unionBbox(nearby),
          source_type: "scheme_entry",
          source_text: nearby.map((block) => block.text ?? "").join("\n").slice(0, 1800),
          block_ids: nearby.map((block) => block.id),
          image_path: nearby.find((block) => block.image_path)?.image_path,
          entry_label: label,
          yield_percent: Number(match[2]),
          inherited_conditions: Object.keys(inherited).length ? inherited : undefined,
        });
      }
      continue;
    }

    if (interesting.length) {
      candidates.push({
        page_no: pageNo,
        bbox: unionBbox(interesting),
        source_type: interesting.some((block) => block.block_type === "image") ? "reaction_scheme" : "text",
        source_text: interesting.map((block) => block.text ?? "").join("\n").slice(0, 2400),
        block_ids: interesting.map((block) => block.id),
        image_path: interesting.find((block) => block.image_path)?.image_path,
        inherited_conditions: Object.keys(inherited).length ? inherited : undefined,
      });
    }
  }
  return candidates;
}

function emptyPayload(example: unknown): Record<string, unknown> {
  if (example && typeof example === "object" && !Array.isArray(example)) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(example as Record<string, unknown>)) {
      output[key] = value && typeof value === "object" && !Array.isArray(value) ? emptyPayload(value) : null;
    }
    return output;
  }
  return {};
}

function shouldKeepReaction(payload: Record<string, unknown>, candidate: Candidate): boolean {
  if (typeof payload.reaction_smiles === "string" && payload.reaction_smiles.includes(">>")) return true;
  if (typeof payload.reaction_latex === "string" && /rightarrow|\\\\to |→|->/.test(payload.reaction_latex)) return true;
  if (candidate.source_type === "scheme_entry" || candidate.entry_label) return true;
  const text = String(payload.reaction_text ?? "");
  return /(>>|→|->|生成.{2,40}|转化为|afford|gave |obtained)/i.test(text);
}

function applyKnownFields(payload: Record<string, unknown>, candidate: Candidate): Record<string, unknown> {
  const next = structuredClone(payload);
  if (candidate.yield_percent != null) {
    next.yield_percent = candidate.yield_percent;
  }
  if (candidate.inherited_conditions && next.conditions && typeof next.conditions === "object") {
    const conditions = next.conditions as Record<string, unknown>;
    for (const [key, value] of Object.entries(candidate.inherited_conditions)) {
      if (conditions[key] == null) conditions[key] = value;
    }
  }
  if (!next.reaction_text && candidate.entry_label) {
    next.reaction_text = `Substrate entry ${candidate.entry_label} is converted to the corresponding product under the scheme conditions reported on page ${candidate.page_no}.`;
  }
  if (!next.reaction_text) {
    next.reaction_text = candidate.source_text.split("\n").filter(Boolean).slice(0, 3).join(" ").slice(0, 400) || null;
  }
  const smilesMatch = candidate.source_text.match(/([A-Za-z0-9@+\-\[\]\(\)=#$\\\/%\.]+>>[A-Za-z0-9@+\-\[\]\(\)=#$\\\/%\.]+)/);
  if (smilesMatch && !next.reaction_smiles) {
    next.reaction_smiles = smilesMatch[1];
  }
  const latexMatch = candidate.source_text.match(/\$\$([\s\S]+?)\$\$|\\mathrm\{[\s\S]+?\}/);
  if (latexMatch && !next.reaction_latex) {
    next.reaction_latex = latexMatch[0];
  }
  return next;
}

async function llmExtractCandidate(example: unknown, candidate: Candidate): Promise<unknown | null> {
  try {
    const content = await chatCompletions([
      {
        role: "system",
        content:
          "Extract one reaction as JSON matching the example schema. Use null for missing fields. Never invent chemistry. Return JSON only.",
      },
      {
        role: "user",
        content: `Schema example:\n${JSON.stringify(example, null, 2)}\n\nEvidence from page ${candidate.page_no}:\n${candidate.source_text}\n\nEntry label: ${candidate.entry_label ?? "none"}`,
      },
    ]);
    const text = content.choices?.[0]?.message?.content;
    if (!text) return null;
    return parseJsonLoose(text);
  } catch {
    return null;
  }
}

async function enrichReaction(
  documentId: string,
  schema: InferredSchema,
  example: unknown,
  rawPayload: unknown,
  candidate: Candidate,
  index: number,
): Promise<{ payload: Record<string, unknown>; validation: Record<string, unknown>; provenance: Record<string, unknown> }> {
  let attempt = validateAgainstSchema(schema, rawPayload);
  if (!attempt.valid) {
    const repaired = await llmExtractCandidate(example, candidate);
    attempt = validateAgainstSchema(schema, repaired ?? applyKnownFields(emptyPayload(example), candidate));
    if (!attempt.valid) {
      attempt = {
        valid: false,
        value: applyKnownFields(emptyPayload(example), candidate),
        errors: attempt.errors,
        missing: attempt.missing,
      };
    }
  }

  const payload = applyKnownFields(attempt.value as Record<string, unknown>, candidate);
  payload.atom_mapped_reaction_smiles = null;
  const validation: Record<string, unknown> = {
    schema_valid: attempt.valid,
    schema_errors: attempt.errors,
    missing: attempt.missing,
    smiles: null,
    reaction_smiles: null,
    atom_mapping: null,
    rxn: null,
  };

  if (typeof payload.reaction_smiles === "string" && payload.reaction_smiles) {
    const reactionCheck = await scientific.validateReaction(payload.reaction_smiles);
    validation.reaction_smiles = reactionCheck;
    if (!reactionCheck.valid) {
      payload.reaction_smiles = null;
      validation.missing = [
        ...(Array.isArray(validation.missing) ? validation.missing : []),
        { field: "reaction_smiles", missing_reason: "extraction_failed" },
      ];
    } else if (reactionCheck.canonical_reaction_smiles) {
      payload.reaction_smiles = reactionCheck.canonical_reaction_smiles;
    }
  }

  if (typeof payload.reaction_smiles === "string" && payload.reaction_smiles) {
    const mapped = await scientific.atomMap(payload.reaction_smiles);
    validation.atom_mapping = mapped;
    payload.atom_mapped_reaction_smiles = mapped.atom_mapped_reaction_smiles;
    validation.mapper = mapped.mapper;
    validation.mapper_version = mapped.mapper_version ?? null;
    if (!mapped.atom_mapped_reaction_smiles) {
      validation.missing = [
        ...(Array.isArray(validation.missing) ? validation.missing : []),
        { field: "atom_mapped_reaction_smiles", missing_reason: mapped.missing_reason ?? "extraction_failed" },
      ];
    }

    const rxnName = `reaction_${String(index + 1).padStart(6, "0")}.rxn`;
    const dest = path.join(documentDir(documentId), "reactions", rxnName);
    const rxn = await scientific.generateRxn({
      reaction_smiles: payload.reaction_smiles,
      output_path: dest,
      reaction_name: `reaction_${index + 1}`,
    });
    validation.rxn = rxn;
    payload.rxn_path = rxn.rxn_path ? path.relative(documentDir(documentId), rxn.rxn_path) : null;
  } else {
    payload.atom_mapped_reaction_smiles = null;
    payload.rxn_path = payload.rxn_path ?? null;
    validation.missing = [
      ...(Array.isArray(validation.missing) ? validation.missing : []),
      { field: "atom_mapped_reaction_smiles", missing_reason: "extraction_failed" },
    ];
  }

  if (!attempt.valid) {
    validation.status = "validation_failed";
  }

  let sourceImage = candidate.image_path ?? null;
  try {
    const cropDest = path.join(documentDir(documentId), "crops", `reaction_${String(index + 1).padStart(6, "0")}.png`);
    const cropped = await scientific.crop({
      pdf_path: getDocumentOrThrow(documentId).file_path,
      page_image_path: listPageImages(documentId).find((item) => item.page_no === candidate.page_no)?.path,
      page_no: candidate.page_no,
      bbox_norm: candidate.bbox,
      output_path: cropDest,
    });
    sourceImage = path.relative(documentDir(documentId), cropped.path);
  } catch {
    // crop is optional evidence
  }

  return {
    payload,
    validation,
    provenance: {
      page_no: candidate.page_no,
      bbox: candidate.bbox,
      source_type: candidate.source_type,
      source_text: candidate.source_text.slice(0, 1200),
      source_image_path: sourceImage,
      entry_label: candidate.entry_label ?? null,
      block_ids: candidate.block_ids,
      atom_mapper: validation.mapper ?? null,
      atom_mapper_version: validation.mapper_version ?? null,
    },
  };
}

export async function runExtraction(options: ExtractOptions): Promise<{ runId: string }> {
  const schema = parseExampleToSchema(options.example);
  const instruction =
    options.instruction ?? "请按照上述 JSON 格式抽取当前 PDF 中所有报告的化学反应。";
  const runId = createRun(options.documentId, options.example, instruction);

  void (async () => {
    try {
      emit(runId, { type: "agent_started", stage: "read_document", message: "正在读取文档", progress: 0.02 });
      const document = getDocumentOrThrow(options.documentId);
      const blocks = listBlocks(options.documentId);
      emit(runId, {
        type: "agent_progress",
        stage: "parse_layout",
        message: "正在解析版面",
        progress: 0.08,
        page_count: document.page_count,
        block_count: blocks.length,
      });

      const pages = Array.from({ length: Math.max(document.page_count, 1) }, (_, index) => index + 1);
      const candidates: Candidate[] = [];
      for (const pageNo of pages) {
        emit(runId, {
          type: "agent_progress",
          stage: "scan_document",
          message: `正在扫描第 ${pageNo} / ${pages.length} 页`,
          progress: 0.1 + (pageNo / pages.length) * 0.25,
        });
        const pageBlocks = blocks.filter((block) => block.page_no === pageNo);
        const found = discoverCandidates(pageBlocks.length ? pageBlocks : blocks.filter((block) => block.page_no === pageNo));
        if (found.length) {
          candidates.push(...found);
          emit(runId, {
            type: "candidate_found",
            stage: "locate_reactions",
            message: `发现 ${found.length} 个潜在反应`,
            page_no: pageNo,
            count: found.length,
          });
        }
      }

      emit(runId, {
        type: "agent_progress",
        stage: "locate_reactions",
        message: `已发现 ${candidates.length} 个候选反应`,
        progress: 0.4,
      });

      // Pi Agent pass: give the model tools and require exhaustive page coverage.
      try {
        const { agent } = createDocumentAgent({
          documentId: options.documentId,
          schema,
          onProgress: (message, extra) => {
            emit(runId, { type: "tool_finished", stage: "structured_extract", message, ...extra });
          },
        });

        emit(runId, { type: "tool_started", stage: "structured_extract", message: "正在结构化抽取", progress: 0.45 });
        const prompt = [
          `Current document_id=${options.documentId}, pages=${document.page_count}.`,
          "This is EXHAUSTIVE extraction. Call get_page_blocks for every page. Do not use search_document as a substitute.",
          `User instruction: ${instruction}`,
          `Target JSON example:\n${JSON.stringify(options.example, null, 2)}`,
          `Locator already found ${candidates.length} candidates:`,
          JSON.stringify(
            candidates.slice(0, 40).map((item) => ({
              page_no: item.page_no,
              source_type: item.source_type,
              entry_label: item.entry_label,
              yield_percent: item.yield_percent,
              source_text: item.source_text.slice(0, 280),
            })),
            null,
            2,
          ),
          "Save each distinct transformation with save_reaction. Validate SMILES. Never invent atom maps.",
        ].join("\n\n");

        if (typeof agent.subscribe === "function") {
          agent.subscribe((event: { type?: string }) => {
            emit(runId, {
              type: "tool_finished",
              stage: "structured_extract",
              message: "Agent 正在阅读文档",
              developer: event,
            });
          });
        }
        if (typeof agent.prompt === "function") {
          await Promise.race([
            agent.prompt(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("agent_timeout")), 180_000)),
          ]);
        }
      } catch (error) {
        emit(runId, {
          type: "agent_progress",
          stage: "structured_extract",
          message: `LLM Agent 不可用，继续用证据扫描与化学校验：${error instanceof Error ? error.message : String(error)}`,
        });
      }

      emit(runId, { type: "agent_progress", stage: "chemistry_validate", message: "正在进行结构校验", progress: 0.62 });

      let saved = 0;
      for (const [index, candidate] of candidates.entries()) {
        try {
          if (candidate.source_type === "reaction_scheme") {
            emit(runId, {
              type: "agent_progress",
              stage: "read_figure",
              message: `正在读取第 ${candidate.page_no} 页反应图`,
            });
          } else {
            emit(runId, {
              type: "agent_progress",
              stage: "parse_conditions",
              message: "正在解析反应条件",
            });
          }

          let raw: unknown = applyKnownFields(emptyPayload(options.example), candidate);
          const llmRaw = await llmExtractCandidate(options.example, candidate);
          if (llmRaw) raw = llmRaw;

          const imagePath = listPageImages(options.documentId).find((item) => item.page_no === candidate.page_no)?.path;
          if (imagePath && candidate.source_type === "reaction_scheme") {
            const vision = await analyzeReactionImage({
              imagePath,
              context: candidate.source_text,
              schema: options.example,
            });
            if (typeof vision === "string") {
              try {
                raw = parseJsonLoose(vision);
              } catch {
                // keep previous raw
              }
            }
          }

          const enriched = await enrichReaction(options.documentId, schema, options.example, raw, candidate, index);
          if (!shouldKeepReaction(enriched.payload, candidate)) {
            emit(runId, {
              type: "agent_progress",
              stage: "chemistry_validate",
              message: `第 ${candidate.page_no} 页候选缺少可核验转化，已跳过`,
            });
            continue;
          }
          if (findDuplicate(options.documentId, enriched.payload, enriched.provenance)) {
            continue;
          }
          const record = saveReaction({
            documentId: options.documentId,
            payload: enriched.payload,
            provenance: enriched.provenance,
            validation: enriched.validation,
          });
          saved += 1;
          emit(runId, {
            type: "record_saved",
            stage: "save_database",
            message: `已确认 ${saved} 条候选反应`,
            reaction_id: record.id,
            progress: 0.62 + ((index + 1) / Math.max(candidates.length, 1)) * 0.28,
          });
        } catch (error) {
          emit(runId, {
            type: "agent_progress",
            stage: "chemistry_validate",
            message: `单条反应抽取失败，已跳过并继续：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      emit(runId, { type: "agent_progress", stage: "extract_tables", message: "正在抽取表格", progress: 0.88 });
      const tableCount = await extractTables(options.documentId, (message, extra) => {
        emit(runId, { type: "agent_progress", stage: "extract_tables", message, ...extra });
      });

      emit(runId, { type: "agent_progress", stage: "deduplicate", message: "正在去重", progress: 0.93 });
      const reactions = listReactions(options.documentId);
      const unique = new Map<string, ReactionRecord>();
      for (const reaction of reactions) {
        const key = JSON.stringify({
          smiles: reaction.payload.reaction_smiles ?? reaction.payload.reaction_text,
          page: reaction.provenance.page_no,
          yield: reaction.payload.yield_percent,
          label: reaction.provenance.entry_label,
        });
        if (!unique.has(key)) unique.set(key, reaction);
      }

      const review = writeReviewJson(options.documentId);
      emit(runId, {
        type: "agent_completed",
        stage: "completed",
        message: `完成：${unique.size} 条反应，${tableCount} 张表格`,
        progress: 1,
        count: unique.size,
        table_count: tableCount,
        review,
      });
      finishRun(runId, "completed", {
        count: unique.size,
        table_count: tableCount,
        candidate_count: candidates.length,
        review,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit(runId, { type: "agent_failed", stage: "failed", message, progress: 1 });
      finishRun(runId, "failed", undefined, message);
    }
  })();

  return { runId };
}

export function seedMockReactions(documentId: string): ReactionRecord[] {
  const document = getDocumentOrThrow(documentId);
  const blocks = listBlocks(documentId);
  const page = blocks.find((block) => REACTION_HINT.test(block.text ?? "")) ?? blocks[0];
  const payload = {
    reaction_text: "乙醇与乙酸发生酯化反应生成乙酸乙酯和水",
    reaction_smiles: "CCO.CC(=O)O>>CC(=O)OCC.O",
    atom_mapped_reaction_smiles: null,
    reaction_latex: "\\mathrm{C_2H_5OH + CH_3COOH \\rightarrow CH_3COOC_2H_5 + H_2O}",
    rxn_path: "reactions/reaction_000001.rxn",
    conditions: {
      catalyst: "H2SO4",
      temperature_c: 80,
      time_h: 2,
    },
    yield_percent: 85,
  };
  const provenance = {
    page_no: page?.page_no ?? 1,
    bbox: page?.bbox_norm ?? [0.12, 0.2, 0.88, 0.62],
    source_type: "reaction_scheme",
    source_text: page?.text ?? document.filename,
    source_image_path: null,
  };
  if (findDuplicate(documentId, payload, provenance)) {
    return listReactions(documentId);
  }
  const record = saveReaction({
    documentId,
    payload,
    provenance,
    validation: {
      schema_valid: true,
      mock: true,
      missing: [{ field: "atom_mapped_reaction_smiles", missing_reason: "extraction_failed" }],
    },
  });
  return [record];
}
