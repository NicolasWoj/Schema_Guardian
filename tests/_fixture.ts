import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filterRelevant } from "../src/context/filter";
import { scanRlsMap, type TableRls } from "../src/context/rls";
import {
  extractTableAccesses,
  extractSensitiveSelects,
  serializeSecurityContext,
} from "../src/context/collector";
import { resolveProvider, type Config } from "../src/config";
import type { ChangedFile } from "../src/types";

/** Utilitaires de chargement de fixtures, partagés par le harnais local et le jeu d'éval. */

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, "fixtures");
export const SAMPLE_REPO = join(FIXTURES_DIR, "sample-repo");

/**
 * Config d'exécution locale (hors GitHub Action), partagée par le harnais et l'éval.
 * Utilise `resolveProvider` — la MÊME inférence par clé que la prod — pour ne pas diverger :
 * une seule clé (Gemini par ex.) suffit à sélectionner le bon fournisseur sans LLM_PROVIDER.
 */
export function localConfig(): Config {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const { provider } = resolveProvider(
    process.env.LLM_PROVIDER,
    !!anthropicApiKey,
    !!geminiApiKey,
  );
  return { githubToken: "local", provider, anthropicApiKey, geminiApiKey };
}

/** Parseur de diff unifié minimal : reconstruit fidèlement le `patch` de chaque fichier. */
export function parseDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;
  let patchLines: string[] = [];
  let inHunk = false;

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
      inHunk = false;
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

    // En-têtes de fichier (`---`/`+++`/`index`/…) : uniquement AVANT le premier hunk. Une fois
    // dans un hunk, une ligne de contenu peut légitimement commencer par `--`/`++` (ex. commentaire
    // SQL `-- …` supprimé, décrément `--i`) — la jeter décalerait la numérotation RIGHT.
    if (
      !inHunk &&
      (line.startsWith("+++") ||
        line.startsWith("---") ||
        line.startsWith("index ") ||
        line.startsWith("new file") ||
        line.startsWith("deleted file") ||
        line.startsWith("rename ") ||
        line.startsWith("similarity "))
    ) {
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
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

export function readFixture(name: string): ChangedFile[] {
  return parseDiff(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

// Carte RLS du dépôt d'exemple, mise en cache (scan une seule fois).
let cachedRls: Map<string, TableRls> | undefined;
function sampleRls(): Map<string, TableRls> {
  if (!cachedRls) cachedRls = scanRlsMap(SAMPLE_REPO);
  return cachedRls;
}

/** Charge une fixture : fichiers pertinents + contexte de sécurité (scan du dépôt d'exemple). */
export function loadCase(name: string): {
  relevant: ChangedFile[];
  context?: string;
} {
  const relevant = filterRelevant(readFixture(name));
  const accesses = extractTableAccesses(relevant);
  const sensitive = extractSensitiveSelects(relevant);
  const context =
    accesses.length > 0 || sensitive.length > 0
      ? serializeSecurityContext(sampleRls(), accesses, sensitive)
      : undefined;
  return { relevant, context };
}
