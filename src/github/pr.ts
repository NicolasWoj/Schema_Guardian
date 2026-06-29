import { context } from "@actions/github";
import type { Octokit } from "./client";
import type { ChangedFile } from "../types";

/** Identité d'une pull request : où la trouver sur GitHub. */
export interface PrRef {
  owner: string;
  repo: string;
  pull_number: number;
}

/**
 * Lit la PR depuis le payload de l'événement.
 * Retourne `null` hors d'un contexte `pull_request` (ex. exécution manuelle / autre event),
 * ce qui permet à l'entrypoint de sortir proprement plutôt que de planter.
 */
export function getPrRef(): PrRef | null {
  const pr = context.payload.pull_request;
  if (!pr) return null;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number,
  };
}

/**
 * Liste les fichiers modifiés par la PR, avec leur `patch`.
 *
 * Sprint 0 : un seul appel (jusqu'à 100 fichiers). La pagination des très grosses PR
 * sera ajoutée avec la gestion des diffs volumineux (Sprint 5).
 */
export async function listChangedFiles(
  octokit: Octokit,
  ref: PrRef,
): Promise<ChangedFile[]> {
  const { data } = await octokit.rest.pulls.listFiles({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pull_number,
    per_page: 100,
  });

  return data.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch,
  }));
}
