import * as core from "@actions/core";
import { loadConfig } from "./config";
import { createClient } from "./github/client";
import { getPrRef, listChangedFiles } from "./github/pr";
import { postSummaryComment } from "./github/review";
import { filterRelevant } from "./context/filter";
import { analyze } from "./analyzer/claude";
import { formatSummary } from "./report/formatter";

/**
 * Point d'entrée (Sprint 1) — MVP `SERVICE_ROLE_LEAK`.
 *
 * Pipeline : payload PR -> diff -> filtre (garde-coût) -> analyse Claude -> commentaire.
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

  // Garde-coût : aucun appel LLM si rien de pertinent n'est touché (succès silencieux).
  if (relevant.length === 0) {
    core.info("Aucun fichier pertinent — analyse ignorée (garde-coût).");
    return;
  }

  if (!config.anthropicApiKey) {
    core.warning(
      "ANTHROPIC_API_KEY absente — fichiers pertinents détectés mais analyse impossible.",
    );
    return;
  }

  core.info(`Analyse de ${relevant.length} fichier(s) pertinent(s)…`);
  const findings = await analyze(config.anthropicApiKey, relevant);
  core.info(`${findings.length} finding(s) confirmé(s).`);

  await postSummaryComment(octokit, ref, formatSummary(findings));
  core.info("Commentaire de synthèse posté ✅");
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
