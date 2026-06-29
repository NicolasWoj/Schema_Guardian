import * as core from "@actions/core";
import { loadConfig } from "./config";
import { createClient } from "./github/client";
import { getPrRef, listChangedFiles } from "./github/pr";
import { postSummaryComment, BOT_MARKER } from "./github/review";
import { filterRelevant } from "./context/filter";
import type { ChangedFile } from "./types";

/**
 * Point d'entrée (Sprint 0).
 *
 * Valide la plomberie de bout en bout : payload PR -> Octokit -> liste des fichiers
 * -> filtre de pertinence -> commentaire posté. Aucune analyse LLM encore.
 */
async function main(): Promise<void> {
  const ref = getPrRef();
  if (!ref) {
    core.info("Aucune pull_request dans le contexte — sortie silencieuse.");
    return;
  }

  const config = loadConfig();
  const octokit = createClient(config.githubToken);

  const changed = await listChangedFiles(octokit, ref);
  const relevant = filterRelevant(changed);

  core.info(
    `Fichiers modifiés : ${changed.length} ; pertinents pour l'audit : ${relevant.length}.`,
  );

  await postSummaryComment(octokit, ref, buildLifeSignComment(changed, relevant));
  core.info("Commentaire « Schema Guardian actif » posté ✅");
}

/** Commentaire de vie : prouve que la chaîne fonctionne et liste les fichiers retenus. */
function buildLifeSignComment(
  changed: ChangedFile[],
  relevant: ChangedFile[],
): string {
  const lines: string[] = [
    BOT_MARKER,
    "### 🛡️ Schema Guardian actif ✅",
    "",
    `Plomberie opérationnelle — ${changed.length} fichier(s) modifié(s), ` +
      `${relevant.length} retenu(s) pour l'audit.`,
    "",
  ];

  if (relevant.length > 0) {
    lines.push("**Fichiers pertinents :**");
    for (const f of relevant) lines.push(`- \`${f.filename}\``);
  } else {
    lines.push("_Aucun fichier pertinent pour l'audit dans cette PR._");
  }

  lines.push(
    "",
    "> ℹ️ Sprint 0 — aucune analyse de sécurité n'est encore active " +
      "(détection `SERVICE_ROLE_LEAK` prévue au Sprint 1).",
  );

  return lines.join("\n");
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
