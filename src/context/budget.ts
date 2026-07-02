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

    if (used + size <= maxChars) {
      kept.push(file);
      used += size;
    } else if (kept.length === 0) {
      // Premier fichier déjà plus gros que le plafond : on ne peut pas « ne rien analyser »,
      // mais on ne doit pas non plus faire exploser le contexte. On envoie une version bornée
      // du patch (jamais > maxChars) ET on le signale comme tronqué — pas de dépassement muet.
      kept.push({ ...file, patch: (file.patch ?? "").slice(0, maxChars) });
      truncated.push(file);
      used = maxChars;
    } else {
      truncated.push(file);
    }
  }

  return { kept, truncated };
}
