import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { REPORT_FINDINGS_TOOL, ReportSchema } from "./schema";
import type { ChangedFile, Finding } from "../types";

/**
 * Modèle par défaut. Choix explicite du plan : bon rapport raisonnement/coût pour un
 * outil qui tourne sur chaque PR. (`claude-opus-4-8` réservé aux analyses approfondies.)
 */
export const MODEL = "claude-sonnet-4-6";

/** Plafond de sortie : les findings sont un petit JSON, mais on garde de la marge. */
const MAX_TOKENS = 8192;

/**
 * Envoie les fichiers pertinents à Claude et renvoie les findings validés.
 * `tool_choice` force l'outil `report_findings` : le modèle ne peut répondre qu'en JSON
 * structuré, jamais en prose.
 */
export async function analyze(
  apiKey: string,
  files: ChangedFile[],
): Promise<Finding[]> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [REPORT_FINDINGS_TOOL],
    tool_choice: { type: "tool", name: "report_findings" },
    messages: [{ role: "user", content: buildUserMessage(files) }],
  });

  return extractFindings(response);
}

/** Extrait le bloc `tool_use` de la réponse, puis valide son contenu. */
export function extractFindings(response: Anthropic.Message): Finding[] {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === REPORT_FINDINGS_TOOL.name,
  );

  // Avec `tool_choice` forcé, ce bloc est garanti ; son absence est traitée comme « rien à signaler ».
  if (!toolUse) return [];

  return validateFindings(toolUse.input);
}

/**
 * Revalide la sortie du modèle avec Zod (bretelles). En cas de non-conformité, on
 * rejette explicitement au lieu de propager un objet douteux dans le pipeline.
 */
export function validateFindings(input: unknown): Finding[] {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Réponse non conforme au schéma report_findings : ${parsed.error.message}`,
    );
  }
  return parsed.data.findings;
}
