import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import type { Finding, Severity } from "./types";
import { SEVERITIES } from "./types";

/**
 * Configuration par dépôt via `.guardianrc.json` (à la racine).
 *
 * - `ignore` / `allowlist` : globs de fichiers à NE PAS analyser (chemins non pertinents /
 *   fichiers serveur de confiance). Matcher de globs maison — aucune dépendance ajoutée.
 * - `failOn` : seuil de blocage opt-in. `none` (défaut) = fail open (l'agent commente, ne bloque pas).
 * - `maxDiffChars` : plafond de diff envoyé au LLM (au-delà : troncature signalée).
 */
export type FailOn = "none" | Severity;

export interface GuardianConfig {
  ignore: string[];
  allowlist: string[];
  failOn: FailOn;
  maxDiffChars: number;
}

const DEFAULT_CONFIG: GuardianConfig = {
  ignore: [],
  allowlist: [],
  failOn: "none",
  maxDiffChars: 60000,
};

const SEVERITY_RANK: Record<Severity, number> = {
  info: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Analyse le contenu de `.guardianrc.json` (fusion avec les défauts). Fonction **pure**,
 * testable et indépendante de la provenance du contenu :
 * - `null` (fichier absent) → défauts, silencieusement (cas normal) ;
 * - JSON invalide → défauts **+ avertissement** (ne PAS confondre avec « absent » : sinon
 *   `failOn` serait désactivé en silence) ;
 * - objet valide → fusion avec les défauts.
 *
 * ⚠️ En production, le contenu doit provenir de la branche **base** (de confiance), jamais du
 * checkout de tête : une PR ne doit pas pouvoir neutraliser le check en modifiant sa propre config.
 */
export function parseGuardianConfig(content: string | null): GuardianConfig {
  if (content === null) {
    return { ...DEFAULT_CONFIG };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    core.warning(".guardianrc.json illisible (JSON invalide) — configuration par défaut appliquée.");
    return { ...DEFAULT_CONFIG };
  }
  if (typeof raw !== "object" || raw === null) {
    core.warning(".guardianrc.json invalide (objet attendu) — configuration par défaut.");
    return { ...DEFAULT_CONFIG };
  }

  const obj = raw as Record<string, unknown>;
  return {
    ignore: asStringArray(obj.ignore, DEFAULT_CONFIG.ignore),
    allowlist: asStringArray(obj.allowlist, DEFAULT_CONFIG.allowlist),
    failOn: asFailOn(obj.failOn),
    maxDiffChars:
      typeof obj.maxDiffChars === "number" && obj.maxDiffChars > 0
        ? obj.maxDiffChars
        : DEFAULT_CONFIG.maxDiffChars,
  };
}

/**
 * Charge `.guardianrc.json` depuis le **disque** (`root`). Réservé au harnais local / aux tests :
 * en production, la config est lue depuis la branche base via l'API (voir `getBaseFileContent`).
 */
export function loadGuardianConfig(root: string): GuardianConfig {
  let content: string | null;
  try {
    content = readFileSync(join(root, ".guardianrc.json"), "utf8");
  } catch {
    content = null;
  }
  return parseGuardianConfig(content);
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : fallback;
}

function asFailOn(value: unknown): FailOn {
  if (value === "none") return "none";
  if (typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)) {
    return value as Severity;
  }
  if (value !== undefined) {
    core.warning(`.guardianrc: failOn="${String(value)}" invalide — repli sur "none".`);
  }
  return "none";
}

/**
 * Convertit un glob (`*`, `**`, `?`) en expression régulière ancrée, avec les sémantiques
 * standard : `*` reste dans un segment, `**` traverse les répertoires, et un `**` suivi d'un
 * séparateur matche zéro ou plusieurs segments — donc un motif « globstar + slash + *.test.ts »
 * couvre aussi un fichier à la racine. Parcours caractère par caractère, sans placeholder ambigu.
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*"; // `**/` : zéro ou plusieurs segments de répertoire
          i += 2;
        } else {
          re += ".*"; // `**` seul : n'importe quoi, séparateurs compris
          i += 1;
        }
      } else {
        re += "[^/]*"; // `*` : dans un seul segment
      }
    } else if (c === "?") {
      re += "[^/]"; // `?` : un caractère, hors séparateur
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c; // échappe les métacaractères regex
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Un chemin correspond-il à au moins un glob ? */
export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** Un fichier doit-il être exclu de l'analyse (ignore OU allowlist) ? */
export function isExcluded(path: string, config: GuardianConfig): boolean {
  return matchesAny(path, config.ignore) || matchesAny(path, config.allowlist);
}

/** Un finding atteint-il le seuil de blocage configuré ? (`none` ne bloque jamais.) */
export function shouldBlock(findings: Finding[], failOn: FailOn): boolean {
  if (failOn === "none") return false;
  const threshold = SEVERITY_RANK[failOn];
  return findings.some((f) => SEVERITY_RANK[f.severity] >= threshold);
}
