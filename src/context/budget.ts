import type { ChangedFile } from "../types";

/**
 * Plafond de diff : plus simple et plus robuste qu'un chunking multi-appels pour une v1.
 * On garde les fichiers tant que le budget de caractères n'est pas dépassé ; le reste est
 * « tronqué » (non analysé) et sera **signalé** dans la synthèse — jamais tronqué en silence.
 * On garde toujours au moins le premier fichier (pour analyser quelque chose).
 */
export interface DiffBudgetResult {
  kept: ChangedFile[];
  truncated: ChangedFile[];
}

export function capToBudget(files: ChangedFile[], maxChars: number): DiffBudgetResult {
  const kept: ChangedFile[] = [];
  const truncated: ChangedFile[] = [];
  let used = 0;

  for (const file of files) {
    const size = file.patch?.length ?? 0;
    if (kept.length === 0 || used + size <= maxChars) {
      kept.push(file);
      used += size;
    } else {
      truncated.push(file);
    }
  }

  return { kept, truncated };
}
