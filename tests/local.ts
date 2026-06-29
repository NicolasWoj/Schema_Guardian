import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filterRelevant } from "../src/context/filter";
import { validateFindings, analyze } from "../src/analyzer/claude";
import { formatSummary } from "../src/report/formatter";
import type { ChangedFile } from "../src/types";

/**
 * Harnais de test local (Sprint 1).
 *
 *  1. Aperçu du filtre sur chaque fixture (sans GitHub ni LLM).
 *  2. Auto-tests hors-ligne du parsing / validation / rendu (cœur de la robustesse).
 *  3. Analyse RÉELLE via l'API si ANTHROPIC_API_KEY est présente (critère de réussite).
 */

const FIXTURES = ["vulnerable.diff", "clean.diff"];

/** Parseur de diff unifié minimal : suffisant pour les fixtures du projet. */
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

/** Un finding `critical` synthétique pour exercer la validation et le rendu. */
const SAMPLE_TOOL_RESPONSE = {
  findings: [
    {
      category: "SERVICE_ROLE_LEAK",
      severity: "critical",
      file: "app/dashboard/UserList.tsx",
      line: 8,
      title: "Clé service_role exposée dans un Client Component",
      explanation:
        "Le fichier « use client » embarque SUPABASE_SERVICE_ROLE_KEY dans le bundle navigateur ; un attaquant anonyme peut l'extraire et contourner toute la RLS.",
      suggested_fix:
        "Déplacer cet accès dans une route serveur / server action et n'utiliser côté client que NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    },
  ],
};

/** 2. Auto-tests hors-ligne (parse + validation + rendu). */
function offlineSelfTests(): void {
  console.log("\n=== Auto-test hors-ligne (parse + validation + rendu) ===");

  const findings = validateFindings(SAMPLE_TOOL_RESPONSE);
  assert(findings.length === 1, "1 finding attendu");
  assert(findings[0].severity === "critical", "sévérité critical attendue");
  const rendered = formatSummary(findings);
  assert(
    rendered.includes(findings[0].title) && rendered.includes("Critique"),
    "le rendu Markdown doit contenir le titre et la sévérité",
  );
  console.log("  ✓ réponse outillée -> 1 finding critical, rendu Markdown OK");

  const empty = validateFindings({ findings: [] });
  assert(empty.length === 0, "0 finding attendu");
  assert(
    formatSummary(empty).includes("Aucune fuite"),
    "le commentaire vide doit rassurer",
  );
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

/** 3. Analyse réelle si la clé est présente. */
async function realAnalysis(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log(
      "\n(ℹ️ ANTHROPIC_API_KEY absente — analyse réelle ignorée. Auto-tests hors-ligne suffisants.)",
    );
    return;
  }

  console.log("\n=== Analyse réelle via l'API Claude ===");
  for (const name of FIXTURES) {
    const relevant = filterRelevant(readFixture(name));
    const findings = await analyze(apiKey, relevant);
    console.log(`▶ ${name} -> ${findings.length} finding(s)`);
    for (const f of findings) console.log(`    • [${f.severity}] ${f.title}`);
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`Auto-test échoué : ${message}`);
}

async function run(): Promise<void> {
  previewFixtures();
  offlineSelfTests();
  await realAnalysis();
  console.log("\n✅ Harnais local OK.");
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
