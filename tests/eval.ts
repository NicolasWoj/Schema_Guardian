import { createAnalyzer } from "../src/analyzer/provider";
import { loadCase, localConfig } from "./_fixture";
import type { FindingCategory, Severity } from "../src/types";

/**
 * Jeu d'évaluation : mesure précision (0 faux positif visé) et rappel sur l'ensemble des fixtures.
 *
 * Chaque cas déclare :
 *  - `mustFind` : catégories qui DOIVENT apparaître (rappel).
 *  - `allow`    : catégories légitimes ; toute autre catégorie est un faux positif.
 *  - `maxSeverity` : sévérité maximale tolérée pour les catégories `allow`. Les cas **gris**
 *    (table inconnue, RLS sans policy) tolèrent un `info` mais jamais un `medium`/`high`.
 */
interface EvalCase {
  file: string;
  kind: "positive" | "negative" | "grey";
  mustFind: FindingCategory[];
  allow: FindingCategory[];
  maxSeverity: Severity;
}

const RANK: Record<Severity, number> = { info: 1, medium: 2, high: 3, critical: 4 };

const CASES: EvalCase[] = [
  { file: "vulnerable.diff", kind: "positive", mustFind: ["SERVICE_ROLE_LEAK"], allow: ["SERVICE_ROLE_LEAK", "SENSITIVE_OVERFETCH"], maxSeverity: "critical" },
  { file: "orphan.diff", kind: "positive", mustFind: ["ORPHAN_TABLE_ACCESS"], allow: ["ORPHAN_TABLE_ACCESS"], maxSeverity: "critical" },
  { file: "overfetch.diff", kind: "positive", mustFind: ["SENSITIVE_OVERFETCH"], allow: ["SENSITIVE_OVERFETCH"], maxSeverity: "critical" },
  { file: "multi-issue.diff", kind: "positive", mustFind: ["SERVICE_ROLE_LEAK", "SENSITIVE_OVERFETCH"], allow: ["SERVICE_ROLE_LEAK", "SENSITIVE_OVERFETCH", "ORPHAN_TABLE_ACCESS"], maxSeverity: "critical" },
  { file: "clean.diff", kind: "negative", mustFind: [], allow: [], maxSeverity: "info" },
  { file: "protected.diff", kind: "negative", mustFind: [], allow: [], maxSeverity: "info" },
  { file: "server-service-role.diff", kind: "negative", mustFind: [], allow: [], maxSeverity: "info" },
  { file: "wildcard-select.diff", kind: "negative", mustFind: [], allow: [], maxSeverity: "info" },
  { file: "mention-only.diff", kind: "negative", mustFind: [], allow: [], maxSeverity: "info" },
  { file: "unknown-table.diff", kind: "grey", mustFind: [], allow: ["ORPHAN_TABLE_ACCESS"], maxSeverity: "info" },
  { file: "rls-no-policy.diff", kind: "grey", mustFind: [], allow: ["ORPHAN_TABLE_ACCESS"], maxSeverity: "info" },
];

async function run(): Promise<void> {
  console.log(`Jeu d'éval : ${CASES.length} fixtures.\n`);

  const analyzer = createAnalyzer(localConfig());

  // Mode hors-ligne : vérifie le chargement des fixtures + affiche les attendus.
  if (!analyzer) {
    for (const c of CASES) {
      const { relevant } = loadCase(c.file);
      console.log(
        `- ${c.file} [${c.kind}] : ${relevant.length} pertinent(s) | mustFind=[${c.mustFind.join(", ")}] allow=[${c.allow.join(", ")}] max=${c.maxSeverity}`,
      );
    }
    console.log(
      "\n(ℹ️ Aucune clé API — cohérence des fixtures vérifiée. Relancer avec une clé pour mesurer précision/rappel.)",
    );
    return;
  }

  console.log(`Mesure réelle via ${analyzer.provider} (${analyzer.model})…\n`);
  let falsePositives = 0;
  let totalFindings = 0;
  let recallHits = 0;
  let recallTotal = 0;

  for (const c of CASES) {
    const { relevant, context } = loadCase(c.file);
    const { findings } = await analyzer.analyze(relevant, context);
    totalFindings += findings.length;

    const fps = findings.filter(
      (f) => !c.allow.includes(f.category) || RANK[f.severity] > RANK[c.maxSeverity],
    );
    falsePositives += fps.length;

    const missing = c.mustFind.filter((cat) => !findings.some((f) => f.category === cat));
    recallTotal += c.mustFind.length;
    recallHits += c.mustFind.length - missing.length;

    const ok = fps.length === 0 && missing.length === 0;
    const summary = findings.map((f) => `${f.category}:${f.severity}`).join(", ") || "aucun";
    console.log(`${ok ? "✅" : "⚠️ "} ${c.file} [${c.kind}] -> ${summary}`);
    for (const fp of fps) console.log(`     ✗ faux positif : ${fp.category}:${fp.severity} (${fp.file}:${fp.line})`);
    for (const cat of missing) console.log(`     ✗ manqué : ${cat}`);
  }

  console.log(`\nPrécision : ${falsePositives} faux positif(s) sur ${totalFindings} finding(s).`);
  console.log(`Rappel : ${recallHits}/${recallTotal} catégories attendues trouvées.`);
  console.log(
    falsePositives === 0 && recallHits === recallTotal
      ? "\n✅ Objectif atteint : 0 faux positif, rappel complet."
      : "\n⚠️ Écarts à examiner (ajuster le prompt/les fixtures).",
  );
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
