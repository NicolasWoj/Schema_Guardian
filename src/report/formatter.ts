import type { Finding, Severity } from "../types";
import type { TokenUsage } from "../analyzer/provider";
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

/** Options du pied de page de la synthèse (Sprint 5). */
export interface SummaryOptions {
  /** Fichiers non analysés faute de budget de diff. */
  truncated?: string[];
  /** Tokens consommés (journalisation des coûts). */
  usage?: TokenUsage;
  /** Seuil de blocage configuré (`none`, `high`, …). */
  failOn?: string;
  /** La PR est-elle bloquée par ce check ? */
  blocked?: boolean;
}

/**
 * Commentaire de synthèse — **source de vérité** (upserté). Liste tous les findings triés par
 * sévérité, plus un pied de page : troncature signalée, blocage éventuel, coût en tokens.
 */
export function formatSummary(findings: Finding[], opts: SummaryOptions = {}): string {
  const lines: string[] = [BOT_MARKER, "### 🛡️ Schema Guardian", ""];

  if (findings.length === 0) {
    lines.push("✅ Aucun problème de sécurité détecté dans les fichiers analysés.");
  } else {
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
  }

  const footer: string[] = [];
  if (opts.truncated && opts.truncated.length > 0) {
    footer.push(
      `⚠️ Diff volumineux : ${opts.truncated.length} fichier(s) non analysé(s) (tronqués) — ` +
        opts.truncated.map((f) => `\`${f}\``).join(", ") +
        ".",
    );
  }
  if (opts.blocked) {
    footer.push(`⛔ Ce check **bloque** la PR (seuil \`failOn="${opts.failOn}"\` atteint).`);
  }
  if (opts.usage) {
    footer.push(`_Coût : ${opts.usage.inputTokens} tokens in / ${opts.usage.outputTokens} out._`);
  }
  if (footer.length > 0) {
    lines.push("---", ...footer);
  }

  return lines.join("\n").trimEnd();
}

/**
 * Corps d'un commentaire **ancré sur la ligne** du finding.
 * Le chemin/ligne sont portés par l'ancrage GitHub lui-même.
 */
export function formatInlineComment(f: Finding): string {
  return [
    BOT_MARKER,
    `**${SEVERITY_LABEL[f.severity]} — ${f.title}**`,
    "",
    `**Catégorie :** \`${f.category}\``,
    `**Risque :** ${f.explanation}`,
    `**Correctif :** ${f.suggested_fix}`,
  ].join("\n");
}
