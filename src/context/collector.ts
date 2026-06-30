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

/** Un `select()` ajouté par la PR qui tire au moins une colonne manifestement sensible. */
export interface SensitiveSelect {
  table?: string;
  columns: string[];
  file: string;
  line: number;
}

/**
 * Détection de colonne sensible, par **segments** (`_`) plutôt que par sous-chaîne — le levier
 * de précision (contrainte n°1). On évite ainsi les faux positifs du type `token_count`,
 * `cvv_verified`, `pwd_attempts`, `secretary`… tout en gardant `password_hash`, `access_token`, etc.
 *
 * Règle : sensible si un **segment** est un mot sensible (ou une **séquence** de segments l'est),
 * SAUF si le dernier segment est un **qualificatif de métadonnée** (drapeau / compteur / horodatage)
 * — auquel cas la colonne décrit une info *sur* la donnée, pas la donnée elle-même.
 * `email` et les noms génériques (`id`, `title`, `value`, `body`, `data`, `*`) ne matchent rien.
 */
const SENSITIVE_SEGMENTS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "secrets",
  "token",
  "tokens",
  "ssn",
  "cvv",
  "cvc",
  "apikey",
  "privatekey",
]);

/** Noms composés à haute confiance (séquences de segments dont aucun n'est sensible seul). */
const SENSITIVE_PHRASES: string[][] = [
  ["api", "key"],
  ["private", "key"],
  ["credit", "card"],
  ["card", "number"],
  ["social", "security"],
];

/** Si le DERNIER segment en est un, la colonne est une métadonnée (pas la valeur sensible). */
const METADATA_QUALIFIERS = new Set([
  "verified",
  "validated",
  "valid",
  "count",
  "used",
  "attempts",
  "match",
  "status",
  "required",
  "enabled",
  "disabled",
  "failed",
  "exists",
  "present",
  "changed",
  "at",
  "ts",
  "expires",
  "expiry",
  "expired",
  "ttl",
  "last",
  "updated",
  "created",
]);

const SELECT_RE = /\.select\(\s*['"`]([^'"`]*)['"`]/g;
const FROM_INLINE_RE = /\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/;

function containsSequence(segments: string[], phrase: string[]): boolean {
  for (let i = 0; i + phrase.length <= segments.length; i++) {
    if (phrase.every((p, j) => segments[i + j] === p)) return true;
  }
  return false;
}

/** Une colonne est-elle manifestement sensible ? (segments + exclusion des qualificatifs) */
export function isSensitiveColumn(column: string): boolean {
  const norm = column.toLowerCase().trim();
  if (!norm || norm === "*") return false;

  const segments = norm.split(/[_.]/).filter(Boolean);

  if (SENSITIVE_PHRASES.some((phrase) => containsSequence(segments, phrase))) {
    return true;
  }

  if (!segments.some((s) => SENSITIVE_SEGMENTS.has(s))) return false;

  // Dernier segment = métadonnée -> la colonne décrit la donnée, ne l'expose pas.
  const last = segments[segments.length - 1];
  return !METADATA_QUALIFIERS.has(last);
}

/**
 * Repère les `select()` des **lignes ajoutées** qui tirent une colonne sensible. Pré-scan
 * déterministe servant de grounding au modèle (comme la carte RLS). `select('*')` ne matche
 * aucun motif → jamais signalé automatiquement.
 *
 * La table est associée par le `.from()` de la même ligne ; à défaut, par le dernier `from()`
 * vu dans le hunk (gère le chaînage `from()` puis `.select()` sur des lignes séparées).
 */
export function extractSensitiveSelects(files: ChangedFile[]): SensitiveSelect[] {
  const out: SensitiveSelect[] = [];

  for (const file of files) {
    if (!file.patch) continue;
    let newLine = 0;
    let inHunk = false;
    let lastFrom: string | undefined;

    for (const raw of file.patch.split("\n")) {
      const header = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (header) {
        newLine = parseInt(header[1], 10);
        inHunk = newLine >= 1;
        lastFrom = undefined;
        continue;
      }
      if (!inHunk) continue;

      const marker = raw[0];
      if (marker === "+" || marker === " ") {
        const content = raw.slice(1);
        const fromMatch = content.match(FROM_INLINE_RE);
        if (fromMatch) lastFrom = fromMatch[1].toLowerCase();

        if (marker === "+") {
          SELECT_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = SELECT_RE.exec(content)) !== null) {
            const columns = m[1]
              .split(",")
              .map((c) => c.trim().replace(/['"`]/g, ""))
              .filter(Boolean);
            const sensitive = columns.filter(isSensitiveColumn);
            if (sensitive.length > 0) {
              out.push({
                table: fromMatch ? fromMatch[1].toLowerCase() : lastFrom,
                columns: sensitive,
                file: file.filename,
                line: newLine,
              });
            }
          }
        }
        newLine++;
      } else if (marker === "-" || marker === "\\") {
        // ligne supprimée / « no newline » : pas de numéro RIGHT consommé.
      } else {
        inHunk = false;
      }
    }
  }

  return out;
}

/** Sérialise la carte RLS, les tables touchées et les colonnes sensibles en un bloc injecté au prompt. */
export function serializeSecurityContext(
  map: Map<string, TableRls>,
  accesses: TableAccess[],
  sensitiveSelects: SensitiveSelect[] = [],
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

  lines.push("", "Sensitive columns selected by this PR (potential over-fetch):");
  if (sensitiveSelects.length === 0) {
    lines.push("- (none detected)");
  } else {
    for (const s of sensitiveSelects) {
      const where = s.table ? `from \`${s.table}\` ` : "";
      lines.push(`- ${where}selects \`${s.columns.join("`, `")}\` at ${s.file}:${s.line}`);
    }
  }

  return lines.join("\n");
}
