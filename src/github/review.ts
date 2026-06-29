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
 * L'ancrage ligne par ligne arrive au Sprint 2.
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
