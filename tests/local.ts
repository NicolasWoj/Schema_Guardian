import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filterRelevant } from "../src/context/filter";
import type { ChangedFile } from "../src/types";

/**
 * Harnais de test local (Sprint 0).
 *
 * Rejoue un diff de fixture SANS GitHub ni LLM : on parse le diff unifié en
 * `ChangedFile[]`, on applique le filtre de pertinence, et on imprime le résultat.
 * C'est l'outil qui permettra d'itérer vite et sans coût sur les sprints suivants.
 */

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

    // En-têtes de fichier / méta : ignorés.
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

    // En-tête de hunk : conservé dans le patch (utile pour les sprints suivants).
    if (line.startsWith("@@")) {
      patchLines.push(line);
      continue;
    }

    if (line.startsWith("+")) {
      current.additions++;
      patchLines.push(line);
    } else if (line.startsWith("-")) {
      current.deletions++;
      patchLines.push(line);
    } else {
      patchLines.push(line); // ligne de contexte
    }
  }

  flush();
  return files;
}

function run(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const diff = readFileSync(join(here, "fixtures", "sample.diff"), "utf8");
  const files = parseDiff(diff);

  console.log(`Fichiers modifiés (${files.length}) :`);
  for (const f of files) {
    console.log(`  - ${f.filename} (+${f.additions}/-${f.deletions})`);
  }
  console.log();

  const relevant = filterRelevant(files);
  console.log(`Fichiers pertinents pour l'audit (${relevant.length}) :`);
  for (const f of relevant) {
    console.log(`  ✓ ${f.filename}`);
  }
  console.log();
  console.log("✅ Plomberie locale OK.");
}

run();
