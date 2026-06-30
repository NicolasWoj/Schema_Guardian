import type { ChangedFile } from "../types";
import { type TableRls, statusFor, statusLabel } from "./rls";

/**
 * Collecte le contexte de sécurité passé au modèle :
 *  - les accès `supabase.from('X')` **introduits par la PR** (lignes ajoutées) avec leur ligne,
 *  - une sérialisation de la carte RLS + des tables touchées et leur statut.
 *
 * Le modèle reçoit cette « vérité terrain » pour raisonner sur du concret plutôt que de deviner.
 */

export interface TableAccess {
  table: string;
  file: string;
  line: number;
}

const FROM_RE = /\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

/**
 * Extrait les accès `from()` des **lignes ajoutées** du diff, avec leur numéro de ligne côté
 * RIGHT (pour pouvoir ancrer le finding). Un accès préexistant (ligne de contexte) n'est pas
 * introduit par la PR : on ne le remonte pas.
 */
export function extractTableAccesses(files: ChangedFile[]): TableAccess[] {
  const accesses: TableAccess[] = [];

  for (const file of files) {
    if (!file.patch) continue;
    let newLine = 0;
    let inHunk = false;

    for (const raw of file.patch.split("\n")) {
      const header = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (header) {
        newLine = parseInt(header[1], 10);
        inHunk = newLine >= 1;
        continue;
      }
      if (!inHunk) continue;

      const marker = raw[0];
      if (marker === "+") {
        const content = raw.slice(1);
        FROM_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FROM_RE.exec(content)) !== null) {
          accesses.push({ table: m[1].toLowerCase(), file: file.filename, line: newLine });
        }
        newLine++;
      } else if (marker === " ") {
        newLine++;
      } else if (marker === "-" || marker === "\\") {
        // ligne supprimée / « no newline » : pas de numéro RIGHT consommé.
      } else {
        inHunk = false;
      }
    }
  }

  return accesses;
}

/** Sérialise la carte RLS + les tables touchées en un bloc texte injecté dans le prompt. */
export function serializeSecurityContext(
  map: Map<string, TableRls>,
  accesses: TableAccess[],
): string {
  const lines: string[] = [
    "# DATABASE SECURITY CONTEXT (ground truth scanned from the repo's SQL migrations)",
    "",
    "Known tables and their RLS status:",
  ];

  if (map.size === 0) {
    lines.push("- (no SQL migrations found in the repository)");
  } else {
    for (const table of [...map.keys()].sort()) {
      const entry = map.get(table)!;
      const policyCount = entry.policies.length;
      let detail: string;
      if (!entry.rlsEnabled) detail = "NOT PROTECTED (no row level security)";
      else if (policyCount > 0)
        detail = `PROTECTED (RLS enabled, ${policyCount} ${policyCount > 1 ? "policies" : "policy"})`;
      else detail = "RLS enabled but NO policy (deny-all)";
      lines.push(`- ${table}: ${detail}`);
    }
  }

  lines.push("", "Tables accessed by this PR (added supabase.from() calls):");
  if (accesses.length === 0) {
    lines.push("- (none)");
  } else {
    for (const a of accesses) {
      lines.push(`- \`${a.table}\` at ${a.file}:${a.line} -> ${statusLabel(statusFor(map, a.table))}`);
    }
  }

  lines.push(
    "",
    "Any accessed table NOT in the known list above is UNKNOWN — do NOT assert ORPHAN_TABLE_ACCESS for it (at most a single `info` phrased as a question).",
  );

  return lines.join("\n");
}
