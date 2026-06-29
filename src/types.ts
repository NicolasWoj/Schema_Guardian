/**
 * Types partagés du projet.
 *
 * `Finding` / `Severity` / `FindingCategory` ne sont pas encore produits au Sprint 0
 * (aucune analyse LLM). Ils sont définis ici dès maintenant pour figer le contrat de
 * sortie de l'analyzer et éviter une refonte de types au Sprint 1.
 */

export type Severity = "critical" | "high" | "medium" | "info";

export type FindingCategory =
  | "ORPHAN_TABLE_ACCESS"
  | "SERVICE_ROLE_LEAK"
  | "SENSITIVE_OVERFETCH";

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
