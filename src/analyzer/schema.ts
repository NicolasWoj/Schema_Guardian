import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Schéma de sortie structurée de l'analyzer.
 *
 * Deux représentations volontairement maintenues en parallèle (ceinture + bretelles) :
 *  - `REPORT_FINDINGS_TOOL` : le JSON Schema envoyé à l'API en `strict: true`.
 *    L'API garantit alors que `tool_use.input` est conforme.
 *  - `ReportSchema` (Zod) : revalidation côté Node après réception, pour récupérer
 *    un objet **typé** et rejeter proprement toute dérive plutôt que de planter.
 *
 * Sprint 1 : une seule catégorie active (`SERVICE_ROLE_LEAK`). L'enum s'étendra
 * catégorie par catégorie aux sprints suivants.
 */

export const FindingSchema = z.object({
  category: z.enum(["SERVICE_ROLE_LEAK"]),
  severity: z.enum(["critical", "high", "medium", "info"]),
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  explanation: z.string(),
  suggested_fix: z.string(),
});

export const ReportSchema = z.object({
  findings: z.array(FindingSchema),
});

export type Report = z.infer<typeof ReportSchema>;

/**
 * Outil `report_findings` en strict tool use.
 * `additionalProperties: false` + `required` exhaustif sont exigés par le mode strict
 * et garantissent que le modèle ne peut ni inventer de champ ni en omettre.
 */
export const REPORT_FINDINGS_TOOL: Anthropic.Tool = {
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
            category: {
              type: "string",
              enum: ["SERVICE_ROLE_LEAK"],
            },
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "info"],
            },
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
          required: [
            "category",
            "severity",
            "file",
            "line",
            "title",
            "explanation",
            "suggested_fix",
          ],
        },
      },
    },
    required: ["findings"],
  },
};
