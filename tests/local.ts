import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filterRelevant } from "../src/context/filter";
import { validateFindings } from "../src/analyzer/schema";
import { createAnalyzer } from "../src/analyzer/provider";
import { resolveProvider } from "../src/config";
import {
  formatSummary,
  formatInlineComment,
  formatReviewSummary,
} from "../src/report/formatter";
import {
  commentableLinesInPatch,
  commentableLinesByFile,
  partitionByAnchorability,
} from "../src/github/diff";
import type { ChangedFile, Finding } from "../src/types";
import type { Config, ProviderName } from "../src/config";

/**
 * Harnais de test local (Sprint 2).
 *
 *  1. Aperçu du filtre sur chaque fixture (sans GitHub ni LLM).
 *  2. Auto-tests hors-ligne : parsing/validation/rendu (Sprint 1) + ancrage (Sprint 2).
 *  3. Analyse RÉELLE via le fournisseur sélectionné si sa clé est présente.
 */

const FIXTURES = ["vulnerable.diff", "clean.diff"];

/** Parseur de diff unifié minimal : reconstruit fidèlement le `patch` de chaque fichier. */
function parseDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;
  let patchLines: string[] = [];

  const flush = (): void => {
    if (!current) return;
    current.patch = patchLines.join("\n");
    current.changes = current.additions + current.deletions;
    files.push(current);
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      patchLines = [];
      const match = line.match(/ b\/(.+)$/);
      current = {
        filename: match ? match[1] : "unknown",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 0,
        patch: "",
      };
      continue;
    }

    if (!current) continue;

    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("rename ") ||
      line.startsWith("similarity ")
    ) {
      continue;
    }

    // On conserve l'en-tête de hunk et les lignes +/-/contexte dans le patch
    // (c'est ce que `diff.ts` consomme pour calculer les lignes commentables).
    if (line.startsWith("@@")) {
      patchLines.push(line);
    } else if (line.startsWith("+")) {
      current.additions++;
      patchLines.push(line);
    } else if (line.startsWith("-")) {
      current.deletions++;
      patchLines.push(line);
    } else {
      patchLines.push(line);
    }
  }

  flush();
  return files;
}

const here = dirname(fileURLToPath(import.meta.url));

function readFixture(name: string): ChangedFile[] {
  return parseDiff(readFileSync(join(here, "fixtures", name), "utf8"));
}

/** Fabrique un finding minimal pour les tests. */
function makeFinding(file: string, line: number, title: string): Finding {
  return {
    category: "SERVICE_ROLE_LEAK",
    severity: "critical",
    file,
    line,
    title,
    explanation: "Exposition de la clé service_role au navigateur.",
    suggested_fix: "Déplacer l'accès côté serveur ; utiliser la clé anon côté client.",
  };
}

/** 1. Aperçu du filtre par fixture. */
function previewFixtures(): void {
  for (const name of FIXTURES) {
    const files = readFixture(name);
    const relevant = filterRelevant(files);
    console.log(`▶ Fixture : ${name}`);
    console.log(
      `  fichiers modifiés : ${files.length} | pertinents : ${relevant.length}`,
    );
    for (const f of relevant) console.log(`    ✓ ${f.filename}`);
  }
}

const SAMPLE_TOOL_RESPONSE = {
  findings: [makeFinding("app/dashboard/UserList.tsx", 8, "Clé service_role exposée")],
};

/** 2a. Auto-tests hors-ligne — parsing / validation / rendu (Sprint 1). */
function offlineSelfTests(): void {
  console.log("\n=== Auto-test hors-ligne (parse + validation + rendu) ===");

  const findings = validateFindings(SAMPLE_TOOL_RESPONSE);
  assert(findings.length === 1, "1 finding attendu");
  assert(findings[0].severity === "critical", "sévérité critical attendue");
  assert(
    formatSummary(findings).includes("Critique"),
    "le rendu Markdown doit contenir la sévérité",
  );
  console.log("  ✓ réponse outillée -> 1 finding critical, rendu Markdown OK");

  const empty = validateFindings({ findings: [] });
  assert(empty.length === 0, "0 finding attendu");
  assert(formatSummary(empty).includes("Aucune fuite"), "le commentaire vide doit rassurer");
  console.log("  ✓ réponse vide -> commentaire « aucune fuite »");

  let rejected = false;
  try {
    validateFindings({ findings: [{ category: "NOPE", severity: "boom" }] });
  } catch {
    rejected = true;
  }
  assert(rejected, "une réponse non conforme doit être rejetée");
  console.log("  ✓ réponse non conforme -> rejetée");
}

/** 2b. Auto-tests hors-ligne — ancrage ligne par ligne (Sprint 2). */
function offlineAnchorTests(): void {
  console.log("\n=== Auto-test hors-ligne (ancrage ligne par ligne) ===");

  const byFile = commentableLinesByFile(readFixture("vulnerable.diff"));
  const ul = byFile.get("app/dashboard/UserList.tsx");
  assert(!!ul, "UserList.tsx présent dans la carte");
  assert(ul!.size === 16 && ul!.has(8), "16 lignes commentables dont la 8");
  console.log(`  ✓ lignes commentables de UserList.tsx : ${ul!.size} (dont la 8)`);

  const findings = [
    makeFinding("app/dashboard/UserList.tsx", 8, "Sur une ligne du diff"),
    makeFinding("app/dashboard/UserList.tsx", 99, "Hors du diff"),
  ];
  const { anchored, unanchored } = partitionByAnchorability(findings, byFile);
  assert(anchored.length === 1 && anchored[0].line === 8, "ligne 8 ancrée");
  assert(unanchored.length === 1 && unanchored[0].line === 99, "ligne 99 en synthèse");
  console.log("  ✓ partition : ligne 8 ancrée, ligne 99 en synthèse");

  const inline = formatInlineComment(anchored[0]);
  const summary = formatReviewSummary(unanchored, findings.length);
  assert(inline.includes(anchored[0].title), "le commentaire en ligne contient le titre");
  assert(summary.includes(unanchored[0].title), "la synthèse liste le non-ancré");
  console.log("  ✓ rendu : commentaire en ligne + synthèse des non-ancrés");

  // Garde-fou : un en-tête `+0` ne doit jamais produire de ligne 0 (sinon 422).
  const malformed = commentableLinesInPatch("@@ -1,5 +0,1 @@\n+contenu");
  assert(malformed.size === 0, "un en-tête +0 ne doit produire aucune ligne");
  console.log("  ✓ en-tête malformé (+0) -> aucune ligne commentable");
}

/** 3. Analyse réelle si la clé du fournisseur sélectionné est présente. */
async function realAnalysis(): Promise<void> {
  const provider: ProviderName =
    (process.env.LLM_PROVIDER ?? "claude").trim().toLowerCase() === "gemini"
      ? "gemini"
      : "claude";

  const config: Config = {
    githubToken: "local",
    provider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };

  const analyzer = createAnalyzer(config);
  if (!analyzer) {
    console.log(
      `\n(ℹ️ Clé absente pour le fournisseur « ${provider} » — analyse réelle ignorée. Auto-tests hors-ligne suffisants.)`,
    );
    return;
  }

  console.log(`\n=== Analyse réelle via ${analyzer.provider} (${analyzer.model}) ===`);
  for (const name of FIXTURES) {
    const relevant = filterRelevant(readFixture(name));
    const findings = await analyzer.analyze(relevant);
    console.log(`▶ ${name} -> ${findings.length} finding(s)`);
    for (const f of findings) {
      console.log(`    • [${f.severity}] ${f.file}:${f.line} — ${f.title}`);
    }
  }
}

/** 2c. Auto-tests hors-ligne — sélection / inférence du fournisseur. */
function offlineProviderTests(): void {
  console.log("\n=== Auto-test hors-ligne (sélection du fournisseur) ===");

  assert(resolveProvider("gemini", true, true).provider === "gemini", "valeur explicite gemini");
  assert(resolveProvider("CLAUDE", false, false).provider === "claude", "valeur explicite claude (casse)");
  // Variable vide (variable GitHub non définie) -> inférence depuis la clé présente.
  assert(resolveProvider("", false, true).provider === "gemini", "vide + clé gemini -> gemini");
  assert(resolveProvider("", true, false).provider === "claude", "vide + clé claude -> claude");
  assert(resolveProvider(undefined, false, false).provider === "claude", "absent + aucune clé -> claude");
  const typo = resolveProvider("gemni", false, true);
  assert(typo.provider === "gemini" && !!typo.warning, "typo -> inférence + avertissement");
  console.log("  ✓ explicite gagne, vide -> inférence par la clé, typo -> inférence + avertissement");
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`Auto-test échoué : ${message}`);
}

async function run(): Promise<void> {
  previewFixtures();
  offlineSelfTests();
  offlineAnchorTests();
  offlineProviderTests();
  await realAnalysis();
  console.log("\n✅ Harnais local OK.");
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
