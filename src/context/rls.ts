import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Scan des migrations SQL du dépôt → carte `table → statut RLS`.
 *
 * « Protégée » = RLS activée ET au moins une policy. Une table avec RLS mais sans policy
 * est en réalité deny-all (rien n'est lisible) : ce n'est pas une exposition. Le danger,
 * c'est l'absence de RLS sur une table existante. Une table jamais vue dans les migrations
 * est UNKNOWN — l'agent ne devra jamais l'affirmer orpheline.
 */

export type RlsStatus = "protected" | "no_rls" | "rls_no_policy" | "unknown";

export interface TableRls {
  table: string;
  rlsEnabled: boolean;
  policies: string[];
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  "coverage",
]);

/** Retire les commentaires SQL (bloc puis ligne) avant parsing — évite de compter une policy commentée. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?(\w+)[`"]?/gi;
const ENABLE_RLS_RE =
  /alter\s+table\s+(?:only\s+)?(?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?(\w+)[`"]?\s+enable\s+row\s+level\s+security/gi;
// Le nom de policy est consommé comme un TOUT (identifiant entre guillemets/backticks, qui
// peut contenir « on », ou identifiant nu) avant de s'ancrer sur le vrai ` ON <table>`.
const CREATE_POLICY_RE =
  /create\s+policy\s+(?:"[^"]*"|`[^`]*`|\w+)\s+on\s+(?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?(\w+)[`"]?/gi;

/** Liste récursivement les fichiers `.sql` sous `root` (en ignorant les dossiers lourds). */
function findSqlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dossier illisible : on ignore
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sql")) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Parse un texte SQL (un fichier de migration) et accumule dans `map`.
 * Fonction pure (hors I/O) — exportée pour être testable unitairement.
 */
export function parseRls(
  sql: string,
  map: Map<string, TableRls> = new Map(),
): Map<string, TableRls> {
  const ensure = (raw: string): TableRls => {
    const table = raw.toLowerCase();
    let entry = map.get(table);
    if (!entry) {
      entry = { table, rlsEnabled: false, policies: [] };
      map.set(table, entry);
    }
    return entry;
  };

  const clean = stripSqlComments(sql);
  for (const m of clean.matchAll(CREATE_TABLE_RE)) ensure(m[1]);
  for (const m of clean.matchAll(ENABLE_RLS_RE)) ensure(m[1]).rlsEnabled = true;
  for (const m of clean.matchAll(CREATE_POLICY_RE)) ensure(m[1]).policies.push("policy");

  return map;
}

/** Construit la carte `table → statut RLS` en scannant tous les `.sql` du dépôt. */
export function scanRlsMap(root: string): Map<string, TableRls> {
  const map = new Map<string, TableRls>();
  for (const file of findSqlFiles(root)) {
    try {
      parseRls(readFileSync(file, "utf8"), map);
    } catch {
      continue; // fichier illisible : on ignore
    }
  }
  return map;
}

/** Statut d'une table d'après la carte (UNKNOWN si jamais vue dans les migrations). */
export function statusFor(map: Map<string, TableRls>, table: string): RlsStatus {
  const entry = map.get(table.toLowerCase());
  if (!entry) return "unknown";
  if (!entry.rlsEnabled) return "no_rls";
  return entry.policies.length > 0 ? "protected" : "rls_no_policy";
}

/** Libellé lisible d'un statut (injecté dans le contexte envoyé au modèle). */
export function statusLabel(status: RlsStatus): string {
  switch (status) {
    case "protected":
      return "PROTECTED (RLS enabled with at least one policy)";
    case "no_rls":
      return "NOT PROTECTED (no row level security — any user can read every row via the API)";
    case "rls_no_policy":
      return "RLS enabled but NO policy (deny-all — not an exposure)";
    case "unknown":
      return "UNKNOWN (table not found in the scanned migrations)";
  }
}
