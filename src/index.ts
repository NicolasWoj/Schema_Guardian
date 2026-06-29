import * as core from "@actions/core";
import { loadConfig } from "./config";
import { createClient } from "./github/client";
import { getPrRef, listChangedFiles } from "./github/pr";
import { postSummaryComment } from "./github/review";
import { filterRelevant } from "./context/filter";
import { createAnalyzer } from "./analyzer/provider";
import { postReview } from "./github/review";
import { commentableLinesByFile, partitionByAnchorability } from "./github/diff";
import {
  formatSummary,
  formatInlineComment,
  formatReviewSummary,
} from "./report/formatter";

/**
 * Point d'entrée (Sprint 2) — détection `SERVICE_ROLE_LEAK` + revue ancrée ligne par ligne.
 *
 * Pipeline : payload PR -> diff -> filtre (garde-coût) -> analyse -> revue ancrée
 * (repli automatique en commentaire de synthèse si l'ancrage n'est pas possible).
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

  const analyzer = createAnalyzer(config);
  if (!analyzer) {
    core.warning(
      `Aucune clé API pour le fournisseur « ${config.provider} » — analyse impossible.`,
    );
    return;
  }

  core.info(
    `Analyse de ${relevant.length} fichier(s) avec ${analyzer.provider} (${analyzer.model})…`,
  );
  const findings = await analyzer.analyze(relevant);
  core.info(`${findings.length} finding(s) confirmé(s).`);

  // Aucun finding : commentaire de synthèse rassurant.
  if (findings.length === 0) {
    await postSummaryComment(octokit, ref, formatSummary([]));
    core.info("Aucun finding — commentaire rassurant posté.");
    return;
  }

  // Partition selon l'ancrabilité (ligne présente dans le diff côté RIGHT).
  const byFile = commentableLinesByFile(relevant);
  const { anchored, unanchored } = partitionByAnchorability(findings, byFile);

  // Aucun ancrage possible : repli sur la synthèse globale.
  if (anchored.length === 0) {
    await postSummaryComment(octokit, ref, formatSummary(findings));
    core.info("Aucun finding ancrable — commentaire de synthèse posté.");
    return;
  }

  const comments = anchored.map((f) => ({
    path: f.file,
    line: f.line,
    body: formatInlineComment(f),
  }));
  const summary = formatReviewSummary(unanchored, findings.length);

  // Garde-fou anti-422 : si l'ancrage est refusé, on replie tout sur la synthèse.
  try {
    await postReview(octokit, ref, comments, summary);
    core.info(
      `Revue ancrée postée : ${anchored.length} en ligne, ${unanchored.length} en synthèse ✅`,
    );
  } catch (err) {
    core.warning(
      `Ancrage refusé (${err instanceof Error ? err.message : String(err)}) — repli sur commentaire de synthèse.`,
    );
    await postSummaryComment(octokit, ref, formatSummary(findings));
  }
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
