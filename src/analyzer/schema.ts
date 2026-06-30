import { z } from "zod";
import { CATEGORIES, SEVERITIES, type Finding } from "../types";

/**
 * Cœur du contrat de sortie, **agnostique du fournisseur**.
 *
 * - `CATEGORIES` / `SEVERITIES` : source unique de vérité (définie dans `types.ts`), réexportée
 *   ici et réutilisée par chaque schéma spécifique (outil Claude, responseSchema Gemini) pour
 *   rester en phase — et dont les unions de types `FindingCategory`/`Severity` sont dérivées.
 * - `ReportSchema` (Zod) : revalidation côté Node de toute sortie LLM. C'est ce contrat
 *   partagé qui rend un changement de fournisseur sûr — le reste du pipeline ne voit que
 *   des `Finding[]` validés, peu importe qui les a produits.
 */

// Réexport pour les fournisseurs (providers/{claude,gemini}.ts les importent depuis ici).
export { CATEGORIES, SEVERITIES };

export const FindingSchema = z.object({
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
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

/** Champs requis par chaque finding (réutilisé par les schémas Claude et Gemini). */
export const FINDING_REQUIRED = [
  "category",
  "severity",
  "file",
  "line",
  "title",
  "explanation",
  "suggested_fix",
] as const;

/**
 * Revalide une sortie LLM brute avec Zod (bretelles). En cas de non-conformité, on
 * rejette explicitement plutôt que de propager un objet douteux dans le pipeline.
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
