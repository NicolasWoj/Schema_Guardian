import type { Octokit } from "./client";
import type { PrRef } from "./pr";

/**
 * Marqueur HTML caché : identifie tout ce que poste le bot, pour l'idempotence.
 * Présent dans la synthèse ET dans chaque commentaire ancré.
 */
export const BOT_MARKER = "<!-- schema-guardian -->";

/**
 * Reconnaît un commentaire écrit par le bot. Le marqueur doit être **en tête** du corps
 * (le bot le pose toujours en première ligne) : un « Quote reply » d'un humain recopie le
 * marqueur mais préfixé de `> `, donc `startsWith` ne le confond pas — on ne risque plus
 * d'éditer ou de supprimer le commentaire d'un humain.
 */
function isBotComment(body: string | null | undefined): boolean {
  return (body ?? "").startsWith(BOT_MARKER);
}

/** Un commentaire ancré sur une ligne précise (côté RIGHT) d'un fichier. */
export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/**
 * Commentaire de synthèse **idempotent** : met à jour en place le commentaire du bot s'il
 * existe déjà (repéré par le marqueur), sinon le crée. Une seule synthèse vivante par PR.
 * `createIfMissing: false` sert à *rétracter* (mettre à jour uniquement si une synthèse existe,
 * sans en créer une nouvelle sur une PR qui n'a jamais rien eu à signaler).
 */
export async function upsertSummaryComment(
  octokit: Octokit,
  ref: PrRef,
  body: string,
  opts: { createIfMissing?: boolean } = {},
): Promise<void> {
  const { createIfMissing = true } = opts;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.pull_number,
    per_page: 100,
  });

  const mine = comments.find((c) => isBotComment(c.body));
  if (mine) {
    await octokit.rest.issues.updateComment({
      owner: ref.owner,
      repo: ref.repo,
      comment_id: mine.id,
      body,
    });
  } else if (createIfMissing) {
    await octokit.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.pull_number,
      body,
    });
  }
}

/**
 * Supprime les commentaires de revue ancrés laissés par le bot lors d'un push précédent
 * (on ne peut pas les éditer : on les supprime puis on recrée les à-jour). Renvoie le nombre supprimé.
 */
export async function deleteBotReviewComments(
  octokit: Octokit,
  ref: PrRef,
): Promise<number> {
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pull_number,
    per_page: 100,
  });

  let removed = 0;
  for (const c of comments) {
    if (isBotComment(c.body)) {
      await octokit.rest.pulls.deleteReviewComment({
        owner: ref.owner,
        repo: ref.repo,
        comment_id: c.id,
      });
      removed++;
    }
  }
  return removed;
}

/**
 * Poste un commentaire de revue ancré sur une ligne (`path` + `line` + `side: RIGHT`).
 * `commitId` doit être le SHA de tête de la PR. La ligne doit être présente dans le diff
 * (sinon 422) : le filtrage incombe à l'appelant, l'appel reste protégé par un try/catch.
 */
export async function postInlineComment(
  octokit: Octokit,
  ref: PrRef,
  commitId: string,
  comment: InlineComment,
): Promise<void> {
  await octokit.rest.pulls.createReviewComment({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pull_number,
    commit_id: commitId,
    path: comment.path,
    line: comment.line,
    side: "RIGHT",
    body: comment.body,
  });
}
