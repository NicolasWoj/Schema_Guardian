import type { Octokit } from "./client";
import type { PrRef } from "./pr";

/**
 * Marqueur HTML caché pour reconnaître les commentaires du bot.
 * Pas encore exploité au Sprint 0 (commentaires non idempotents), mais posé dès
 * maintenant : il servira au dédoublonnage / à la mise à jour au Sprint 5.
 */
export const BOT_MARKER = "<!-- schema-guardian -->";

/**
 * Poste un commentaire de synthèse sur la PR (un commentaire d'issue, non ancré).
 * Sert de repli quand l'ancrage ligne par ligne n'est pas possible.
 */
export async function postSummaryComment(
  octokit: Octokit,
  ref: PrRef,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.pull_number,
    body,
  });
}

/** Un commentaire ancré sur une ligne précise (côté RIGHT) d'un fichier. */
export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/**
 * Poste une revue ancrée ligne par ligne (`createReview`).
 *
 * - `event: "COMMENT"` : la revue commente, elle ne bloque pas (principe « fail open » ;
 *   le blocage opt-in viendra au Sprint 5).
 * - `commit_id` = SHA de tête de la PR, pour rattacher l'ancrage au bon commit.
 * - Chaque commentaire est ancré par `path` + `line` + `side: "RIGHT"`.
 *
 * ⚠️ Toutes les lignes passées ici DOIVENT être présentes dans le diff : viser une ligne
 * hors-diff fait rejeter (422) la revue entière. Le filtrage incombe à l'appelant ;
 * l'appel reste néanmoins protégé par un try/catch côté orchestration.
 */
export async function postReview(
  octokit: Octokit,
  ref: PrRef,
  comments: InlineComment[],
  summaryBody: string,
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pull_number,
    commit_id: ref.headSha, // undefined => GitHub retient le dernier commit de la PR
    event: "COMMENT",
    body: summaryBody,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: "RIGHT" as const,
      body: c.body,
    })),
  });
}
