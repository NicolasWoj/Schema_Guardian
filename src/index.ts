import * as core from "@actions/core";
import { loadConfig } from "./config";
import { createClient } from "./github/client";
import { getPrRef, listChangedFiles } from "./github/pr";
import { postSummaryComment } from "./github/review";
import { filterRelevant } from "./context/filter";
import { createAnalyzer } from "./analyzer/provider";
import { postReview } from "./github/review";
import { commentableLinesByFile, partitionByAnchorability } from "./github/diff";
import { scanRlsMap } from "./context/rls";
import { extractTableAccesses, serializeSecurityContext } from "./context/collector";
import {
  formatSummary,
  formatInlineComment,
  formatReviewSummary,
} from "./report/formatter";

/**
 * Point d'entrée (Sprint 3) — `SERVICE_ROLE_LEAK` + `ORPHAN_TABLE_ACCESS`, revue ancrée.
 *
 * Pipeline : payload PR -> diff -> filtre (garde-coût) -> contexte RLS du dépôt ->
 * analyse -> revue ancrée (repli en synthèse si l'ancrage n'est pas possible).
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

  // Contexte de sécurité (Sprint 3) : on ne scanne le dépôt que si la PR introduit des
  // accès `supabase.from()` — sinon ce contexte n'apporte rien (et on évite un scan inutile).
  const accesses = extractTableAccesses(relevant);
  let securityContext: string | undefined;
  if (accesses.length > 0) {
    const rlsMap = scanRlsMap(process.cwd());
    securityContext = serializeSecurityContext(rlsMap, accesses);
    core.info(
      `Contexte RLS : ${rlsMap.size} table(s) scannée(s), ${accesses.length} accès from() dans la PR.`,
    );
  }

  core.info(
    `Analyse de ${relevant.length} fichier(s) avec ${analyzer.provider} (${analyzer.model})…`,
  );
  const findings = await analyzer.analyze(relevant, securityContext);
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
