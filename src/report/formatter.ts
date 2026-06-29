import type { Finding, Severity } from "../types";
import { BOT_MARKER } from "../github/review";

/** Ordre d'affichage (le plus grave d'abord) et libellés lisibles par sévérité. */
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "🔴 Critique",
  high: "🟠 Élevé",
  medium: "🟡 Moyen",
  info: "🔵 Info",
};

/**
 * Transforme les findings en commentaire Markdown de synthèse, trié par sévérité.
 * Si aucun finding : message rassurant explicite (le silence inquiète plus qu'il ne rassure
 * une fois que des fichiers pertinents ont été analysés).
 */
export function formatSummary(findings: Finding[]): string {
  const lines: string[] = [BOT_MARKER, "### 🛡️ Schema Guardian", ""];

  if (findings.length === 0) {
    lines.push(
      "✅ Aucune fuite de clé `service_role` détectée dans les fichiers analysés.",
    );
    return lines.join("\n");
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const n = findings.length;
  const plural = n > 1 ? "s" : "";
  lines.push(`⚠️ **${n} problème${plural} de sécurité détecté${plural}.**`, "");

  for (const f of sorted) {
    lines.push(`#### ${SEVERITY_LABEL[f.severity]} — ${f.title}`);
    lines.push(`- **Fichier :** \`${f.file}\` (ligne ${f.line})`);
    lines.push(`- **Catégorie :** \`${f.category}\``);
    lines.push(`- **Risque :** ${f.explanation}`);
    lines.push(`- **Correctif :** ${f.suggested_fix}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
