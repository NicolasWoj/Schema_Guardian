/**
 * Types partagés du projet.
 *
 * `CATEGORIES` / `SEVERITIES` sont la **source unique de vérité** : les unions de types en
 * sont dérivées, et `analyzer/schema.ts` les réexporte pour bâtir le schéma Zod et les schémas
 * spécifiques aux fournisseurs. Ajouter une catégorie ici la propage partout (types + runtime).
 */

export const CATEGORIES = [
  "SERVICE_ROLE_LEAK",
  "ORPHAN_TABLE_ACCESS",
  "SENSITIVE_OVERFETCH",
] as const;

export const SEVERITIES = ["critical", "high", "medium", "info"] as const;

export type FindingCategory = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];

/** Une faille confirmée, telle que l'analyzer la rapportera (Sprint 1+). */
export interface Finding {
  category: FindingCategory;
  severity: Severity;
  /** Chemin relatif au repo, exactement tel qu'il apparaît dans le diff. */
  file: string;
  /** Ligne 1-based dans la version NOUVELLE du fichier (côté RIGHT du diff). */
  line: number;
  title: string;
  explanation: string;
  suggested_fix: string;
}

/** Un fichier modifié dans la PR (ou rejoué depuis une fixture locale). */
export interface ChangedFile {
  filename: string;
  /** added | modified | removed | renamed ... (statut GitHub). */
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  /** Diff unifié du fichier. Absent pour les fichiers binaires ou trop volumineux. */
  patch?: string;
}
