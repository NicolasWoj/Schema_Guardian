import type { ChangedFile } from "../types";

/**
 * Filtre de pertinence — le levier de coût n°1.
 *
 * On n'enverra au LLM (Sprint 1+) que les fichiers susceptibles de toucher à la
 * sécurité de l'accès aux données. Heuristique volontairement simple et textuelle :
 *  - les fichiers SQL / migrations sont pertinents par nature (futur contexte RLS) ;
 *  - les fichiers TS/TSX ne le sont que s'ils mentionnent Supabase / service_role.
 *
 * Suffisant comme garde-coût ; affinable plus tard sans changer l'interface.
 */

const TS_EXTENSIONS = [".ts", ".tsx"];
const SQL_EXTENSIONS = [".sql"];

/** Indices textuels d'un accès Supabase / d'une clé d'admin. */
const SUPABASE_HINTS = [
  "supabase",
  "service_role",
  "createClient",
  "createServerClient",
  "createBrowserClient",
];

function hasExtension(filename: string, exts: string[]): boolean {
  const lower = filename.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function looksLikeMigration(filename: string): boolean {
  return /(^|\/)migrations?\//i.test(filename) || hasExtension(filename, SQL_EXTENSIONS);
}

function containsHint(text: string | undefined, hints: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return hints.some((h) => lower.includes(h.toLowerCase()));
}

/** Un fichier mérite-t-il une analyse de sécurité ? */
export function isRelevant(file: ChangedFile): boolean {
  // SQL & migrations : pertinents par nature (carte RLS à venir au Sprint 3).
  if (looksLikeMigration(file.filename)) return true;

  // TS/TSX : pertinents seulement s'ils touchent à Supabase.
  if (hasExtension(file.filename, TS_EXTENSIONS)) {
    return containsHint(file.patch, SUPABASE_HINTS);
  }

  return false;
}

/** Restreint une liste de fichiers modifiés aux seuls fichiers pertinents. */
export function filterRelevant(files: ChangedFile[]): ChangedFile[] {
  return files.filter(isRelevant);
}
