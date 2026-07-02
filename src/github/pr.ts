import { context } from "@actions/github";
import * as core from "@actions/core";
import type { Octokit } from "./client";
import type { ChangedFile } from "../types";

/** Identité d'une pull request : où la trouver sur GitHub. */
export interface PrRef {
  owner: string;
  repo: string;
  pull_number: number;
  /** SHA de tête de la PR — sert de `commit_id` pour ancrer la revue (Sprint 2). */
  headSha?: string;
  /** SHA de la branche **base** (cible) — état de confiance, déjà revu. Sert à lire la config. */
  baseSha?: string;
}

/**
 * Lit la PR depuis le payload de l'événement.
 * Retourne `null` hors d'un contexte `pull_request` (ex. exécution manuelle / autre event),
 * ce qui permet à l'entrypoint de sortir proprement plutôt que de planter.
 */
export function getPrRef(): PrRef | null {
  const pr = context.payload.pull_request;
  if (!pr) return null;

  const headSha = typeof pr.head?.sha === "string" ? pr.head.sha : undefined;
  const baseSha = typeof pr.base?.sha === "string" ? pr.base.sha : undefined;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number,
    headSha,
    baseSha,
  };
}

/**
 * Lit un fichier depuis la branche **base** de la PR (au SHA `baseSha`), via l'API Contents.
 *
 * C'est la parade au contournement de sécurité : la config de l'agent (`.guardianrc.json`)
 * doit venir de l'état **déjà revu et mergé** de la base, pas du checkout de tête que la PR
 * contrôle — sinon une PR malveillante pourrait désactiver le blocage dans son propre diff.
 *
 * Renvoie `null` si le fichier est absent sur la base (404) ou si le SHA de base est indisponible.
 */
export async function getBaseFileContent(
  octokit: Octokit,
  ref: PrRef,
  path: string,
): Promise<string | null> {
  if (!ref.baseSha) {
    core.warning(
      `SHA de base indisponible — lecture de ${path} sur la base impossible, défauts appliqués.`,
    );
    return null;
  }

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: ref.owner,
      repo: ref.repo,
      path,
      ref: ref.baseSha,
    });
    // `getContent` renvoie un tableau pour un dossier ; on n'attend qu'un fichier.
    if (Array.isArray(data)) return null;
    const file = data as { type?: string; content?: string };
    if (file.type !== "file" || typeof file.content !== "string") return null;
    return Buffer.from(file.content, "base64").toString("utf8");
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null; // Fichier absent sur la base : cas normal.
    core.warning(
      `Lecture de ${path} sur la base impossible (${err instanceof Error ? err.message : String(err)}) — défauts appliqués.`,
    );
    return null;
  }
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
