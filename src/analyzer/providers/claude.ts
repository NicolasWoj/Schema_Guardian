import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserMessage } from "../prompt";
import { CATEGORIES, SEVERITIES, FINDING_REQUIRED, validateFindings } from "../schema";
import type { Analyzer } from "../provider";
import type { Finding } from "../../types";

/**
 * Implémentation Claude (Anthropic) — strict tool use + `tool_choice` forcé.
 *
 * Choix de modèle explicite du plan : `claude-sonnet-4-6` (bon rapport raisonnement/coût
 * pour un outil qui tourne sur chaque PR). Surchargeable via `CLAUDE_MODEL`.
 */
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;

/**
 * Outil `report_findings` en `strict: true` : `additionalProperties: false` + `required`
 * exhaustif sont exigés par le mode strict et garantissent une sortie exactement conforme.
 */
const REPORT_FINDINGS_TOOL: Anthropic.Tool = {
  name: "report_findings",
  description: "Report all confirmed security findings for this pull request.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string", enum: [...CATEGORIES] },
            severity: { type: "string", enum: [...SEVERITIES] },
            file: {
              type: "string",
              description: "Repo-relative path, exactly as it appears in the diff.",
            },
            line: {
              type: "integer",
              description: "1-based line in the NEW version of the file (RIGHT side of the diff).",
            },
            title: { type: "string", description: "One-line summary." },
            explanation: {
              type: "string",
              description: "Why it is exploitable. Name the concrete attack.",
            },
            suggested_fix: {
              type: "string",
              description: "Concrete remediation; may include a code or SQL snippet.",
            },
          },
          required: [...FINDING_REQUIRED],
        },
      },
    },
    required: ["findings"],
  },
};

export function createClaudeAnalyzer(
  apiKey: string,
  model: string = process.env.CLAUDE_MODEL || DEFAULT_MODEL,
): Analyzer {
  const client = new Anthropic({ apiKey });

  return {
    provider: "claude",
    model,
    async analyze(files): Promise<Finding[]> {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [REPORT_FINDINGS_TOOL],
        tool_choice: { type: "tool", name: "report_findings" },
        messages: [{ role: "user", content: buildUserMessage(files) }],
      });
      return extractFindings(response);
    },
  };
}

/** Extrait le bloc `tool_use` puis valide son contenu (Zod). */
export function extractFindings(response: Anthropic.Message): Finding[] {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === REPORT_FINDINGS_TOOL.name,
  );
  // Avec `tool_choice` forcé, ce bloc est garanti ; son absence = « rien à signaler ».
  if (!toolUse) return [];
  return validateFindings(toolUse.input);
}
