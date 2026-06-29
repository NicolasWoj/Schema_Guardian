import type { ChangedFile, Finding } from "../types";

/**
 * Parser de hunks maison.
 *
 * Renvoie l'ensemble des lignes **commentables** côté RIGHT (nouvelle version) d'un patch :
 * les lignes ajoutées (`+`) et de contexte (espace). On lit le numéro de départ dans
 * l'en-tête `@@ ... +start[,count] @@` puis on **incrémente nous-mêmes**, sans faire
 * confiance au `count` déclaré — robuste aux diffs mal formés.
 *
 * GitHub n'accepte un commentaire que sur une ligne présente dans le diff ; les lignes
 * supprimées (`-`) sont côté LEFT et ne consomment pas de numéro de ligne côté RIGHT.
 */
export function commentableLinesInPatch(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;

  let newLine = 0;
  let inHunk = false;

  for (const raw of patch.split("\n")) {
    const header = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (header) {
      newLine = parseInt(header[1], 10);
      // Une ligne source commence à 1. Un en-tête `+0` (suppression de fichier, ou diff
      // mal formé) ne doit produire AUCUNE ligne commentable : sinon on ancrerait sur la
      // ligne 0 et GitHub rejetterait toute la revue (422). Garde-fou supplémentaire.
      inHunk = newLine >= 1;
      continue;
    }
    if (!inHunk) continue;

    const marker = raw[0];
    if (marker === "+" || marker === " ") {
      // ligne ajoutée ou de contexte : présente côté RIGHT.
      lines.add(newLine);
      newLine++;
    } else if (marker === "-") {
      // ligne supprimée : côté LEFT, ne consomme pas de numéro RIGHT.
    } else if (marker === "\\") {
      // « \ No newline at end of file » : ignoré.
    } else {
      // ligne inattendue / vide : fin effective du hunk.
      inHunk = false;
    }
  }

  return lines;
}

/** Carte `fichier -> lignes commentables` pour un ensemble de fichiers modifiés. */
export function commentableLinesByFile(
  files: ChangedFile[],
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    map.set(file.filename, commentableLinesInPatch(file.patch));
  }
  return map;
}

export interface AnchorPartition {
  /** Findings dont la ligne est présente dans le diff (ancrables). */
  anchored: Finding[];
  /** Findings hors diff -> repli en synthèse (jamais de 422). */
  unanchored: Finding[];
}

/** Sépare les findings selon que leur `file:line` est commentable ou non. */
export function partitionByAnchorability(
  findings: Finding[],
  byFile: Map<string, Set<number>>,
): AnchorPartition {
  const anchored: Finding[] = [];
  const unanchored: Finding[] = [];

  for (const finding of findings) {
    const lines = byFile.get(finding.file);
    if (lines && lines.has(finding.line)) {
      anchored.push(finding);
    } else {
      unanchored.push(finding);
    }
  }

  return { anchored, unanchored };
}
