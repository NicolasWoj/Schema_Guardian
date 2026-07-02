import * as core from "@actions/core";
import { loadConfig } from "./config";
import { parseGuardianConfig, isExcluded, shouldBlock } from "./guardian-config";
import { createClient } from "./github/client";
import { getPrRef, listChangedFiles, getBaseFileContent } from "./github/pr";
import {
  upsertSummaryComment,
  deleteBotReviewComments,
  postInlineComment,
} from "./github/review";
import { filterRelevant } from "./context/filter";
import { capToBudget } from "./context/budget";
import { createAnalyzer } from "./analyzer/provider";
import { commentableLinesByFile, partitionByAnchorability } from "./github/diff";
import { scanRlsMap } from "./context/rls";
import {
  extractTableAccesses,
  extractSensitiveSelects,
  serializeSecurityContext,
} from "./context/collector";
import { formatSummary, formatInlineComment } from "./report/formatter";

/**
 * Point d'entrée (Sprint 5 / v1.0).
 *
 * Pipeline : PR -> diff -> filtre + exclusions `.guardianrc` -> plafond de diff ->
 * contexte (RLS + colonnes sensibles) -> analyse -> revue ancrée idempotente +
 * synthèse upsertée (source de vérité) -> blocage opt-in (`failOn`).
 */
async function main(): Promise<void> {
  const ref = getPrRef();
  if (!ref) {
    core.info("Aucune pull_request dans le contexte — sortie silencieuse.");
    return;
  }

  const config = loadConfig();
  const octokit = createClient(config.githubToken);

  // Config lue depuis la branche BASE (état de confiance, déjà revu), jamais depuis le checkout
  // de tête : une PR ne peut donc pas neutraliser le check (failOn/ignore) via son propre diff.
  const guardian = parseGuardianConfig(await getBaseFileContent(octokit, ref, ".guardianrc.json"));

  const changed = await listChangedFiles(octokit, ref);
  const candidates = filterRelevant(changed);
  const relevant = candidates.filter((f) => !isExcluded(f.filename, guardian));
  if (relevant.length < candidates.length) {
    core.info(`${candidates.length - relevant.length} fichier(s) exclu(s) par .guardianrc.`);
  }

  // Garde-coût : aucun appel LLM si rien de pertinent n'est touché.
  if (relevant.length === 0) {
    core.info("Aucun fichier pertinent — analyse ignorée (garde-coût).");
    // Idempotence : une PR devenue propre (fichier vulnérable retiré / ignoré) ne doit pas
    // conserver la synthèse et les commentaires ancrés d'un push précédent. On rétracte —
    // sans créer de nouvelle synthèse là où il n'y a jamais rien eu à signaler. Purement
    // ménager : un échec ici ne doit pas faire tomber le check (fail open).
    try {
      await deleteBotReviewComments(octokit, ref);
      await upsertSummaryComment(octokit, ref, formatSummary([]), { createIfMissing: false });
    } catch (err) {
      core.warning(
        `Nettoyage idempotent impossible (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
    return;
  }

  const analyzer = createAnalyzer(config);
  if (!analyzer) {
    core.warning(`Aucune clé API pour le fournisseur « ${config.provider} » — analyse impossible.`);
    return;
  }

  // Plafond de diff : au-delà, on tronque et on le signalera dans la synthèse.
  const { kept, truncated } = capToBudget(relevant, guardian.maxDiffChars);
  if (truncated.length > 0) {
    core.warning(
      `Diff volumineux : ${truncated.length} fichier(s) tronqué(s) (> ${guardian.maxDiffChars} chars).`,
    );
  }

  // Contexte de sécurité (RLS + colonnes sensibles), seulement si utile.
  const accesses = extractTableAccesses(kept);
  const sensitiveSelects = extractSensitiveSelects(kept);
  let securityContext: string | undefined;
  if (accesses.length > 0 || sensitiveSelects.length > 0) {
    const rlsMap = scanRlsMap(process.cwd());
    securityContext = serializeSecurityContext(rlsMap, accesses, sensitiveSelects);
  }

  core.info(
    `Analyse de ${kept.length} fichier(s) avec ${analyzer.provider} (${analyzer.model})…`,
  );
  const { findings, usage } = await analyzer.analyze(kept, securityContext);
  core.info(
    `${findings.length} finding(s). Coût : ${usage.inputTokens} tokens in / ${usage.outputTokens} out.`,
  );

  // Idempotence : on retire d'abord les commentaires de revue du bot du push précédent.
  // Fail open : un échec de suppression (404/403/rate-limit) ne doit PAS abandonner le run
  // avant la synthèse — la synthèse reste la source de vérité et doit toujours être postée.
  try {
    const removed = await deleteBotReviewComments(octokit, ref);
    if (removed > 0) core.info(`${removed} commentaire(s) de revue précédent(s) supprimé(s).`);
  } catch (err) {
    core.warning(
      `Suppression des commentaires de revue précédents impossible (${err instanceof Error ? err.message : String(err)}) — poursuite vers la synthèse.`,
    );
  }

  // Revue ancrée : commentaires individuels sur les lignes présentes dans le diff.
  // La synthèse (ci-dessous) reste la source de vérité — un ancrage refusé n'y perd rien.
  const byFile = commentableLinesByFile(kept);
  const { anchored } = partitionByAnchorability(findings, byFile);
  let posted = 0;
  if (ref.headSha) {
    for (const f of anchored) {
      try {
        await postInlineComment(octokit, ref, ref.headSha, {
          path: f.file,
          line: f.line,
          body: formatInlineComment(f),
        });
        posted++;
      } catch (err) {
        core.warning(
          `Ancrage refusé pour ${f.file}:${f.line} (${err instanceof Error ? err.message : String(err)}) — présent dans la synthèse.`,
        );
      }
    }
  }

  // Synthèse upsertée = source de vérité : tous les findings + troncature + coût + blocage.
  const blocked = shouldBlock(findings, guardian.failOn);
  const summary = formatSummary(findings, {
    truncated: truncated.map((f) => f.filename),
    usage,
    failOn: guardian.failOn,
    blocked,
  });
  await upsertSummaryComment(octokit, ref, summary);
  core.info(`Synthèse mise à jour ✅ (${posted} commentaire(s) ancré(s)).`);

  if (blocked) {
    core.setFailed(
      `Blocage activé : un finding atteint le seuil failOn="${guardian.failOn}".`,
    );
  }
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
