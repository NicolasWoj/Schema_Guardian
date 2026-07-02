import { join } from "node:path";
import { filterRelevant } from "../src/context/filter";
import { validateFindings } from "../src/analyzer/schema";
import { createAnalyzer } from "../src/analyzer/provider";
import { resolveProvider } from "../src/config";
import { formatSummary, formatInlineComment } from "../src/report/formatter";
import {
  commentableLinesInPatch,
  commentableLinesByFile,
  partitionByAnchorability,
} from "../src/github/diff";
import { scanRlsMap, parseRls, statusFor } from "../src/context/rls";
import {
  extractTableAccesses,
  extractSensitiveSelects,
  isSensitiveColumn,
  serializeSecurityContext,
} from "../src/context/collector";
import { loadGuardianConfig, isExcluded, shouldBlock } from "../src/guardian-config";
import { capToBudget } from "../src/context/budget";
import { BOT_MARKER } from "../src/github/review";
import { readFixture, loadCase, FIXTURES_DIR, SAMPLE_REPO } from "./_fixture";
import type { ChangedFile, Finding, FindingCategory, Severity } from "../src/types";
import type { Config, ProviderName } from "../src/config";

/**
 * Harnais de test local (Sprint 5).
 *  1. Aperçu du filtre par fixture.
 *  2. Auto-tests hors-ligne : validation, ancrage, RLS, over-fetch, fournisseur, durcissement.
 *  3. Analyse RÉELLE via le fournisseur sélectionné si sa clé est présente.
 */

const FIXTURES = ["vulnerable.diff", "clean.diff", "orphan.diff", "protected.diff", "overfetch.diff"];

function makeFinding(
  file: string,
  line: number,
  title: string,
  severity: Severity = "critical",
  category: FindingCategory = "SERVICE_ROLE_LEAK",
): Finding {
  return {
    category,
    severity,
    file,
    line,
    title,
    explanation: "Exposition de données sensibles au navigateur.",
    suggested_fix: "Déplacer l'accès côté serveur / réduire le select.",
  };
}

/** 1. Aperçu du filtre par fixture. */
function previewFixtures(): void {
  for (const name of FIXTURES) {
    const files = readFixture(name);
    const relevant = filterRelevant(files);
    console.log(`▶ Fixture : ${name}`);
    console.log(`  fichiers modifiés : ${files.length} | pertinents : ${relevant.length}`);
    for (const f of relevant) console.log(`    ✓ ${f.filename}`);
  }
}

const SAMPLE_TOOL_RESPONSE = {
  findings: [makeFinding("app/dashboard/UserList.tsx", 8, "Clé service_role exposée")],
};

/** 2a. Parsing / validation / rendu. */
function offlineSelfTests(): void {
  console.log("\n=== Auto-test hors-ligne (parse + validation + rendu) ===");

  const findings = validateFindings(SAMPLE_TOOL_RESPONSE);
  assert(findings.length === 1 && findings[0].severity === "critical", "1 finding critical");
  assert(formatSummary(findings).includes("Critique"), "rendu contient la sévérité");
  console.log("  ✓ réponse outillée -> 1 finding critical, rendu Markdown OK");

  const empty = validateFindings({ findings: [] });
  assert(empty.length === 0, "0 finding");
  assert(formatSummary(empty).includes("Aucun problème"), "commentaire vide rassurant");
  console.log("  ✓ réponse vide -> commentaire « aucun problème »");

  let rejected = false;
  try {
    validateFindings({ findings: [{ category: "NOPE", severity: "boom" }] });
  } catch {
    rejected = true;
  }
  assert(rejected, "réponse non conforme rejetée");
  console.log("  ✓ réponse non conforme -> rejetée");
}

/** 2b. Ancrage ligne par ligne. */
function offlineAnchorTests(): void {
  console.log("\n=== Auto-test hors-ligne (ancrage ligne par ligne) ===");

  const byFile = commentableLinesByFile(readFixture("vulnerable.diff"));
  const ul = byFile.get("app/dashboard/UserList.tsx");
  assert(!!ul && ul.size === 16 && ul.has(8), "16 lignes commentables dont la 8");
  console.log(`  ✓ lignes commentables de UserList.tsx : ${ul!.size} (dont la 8)`);

  const findings = [
    makeFinding("app/dashboard/UserList.tsx", 8, "Sur une ligne du diff"),
    makeFinding("app/dashboard/UserList.tsx", 99, "Hors du diff"),
  ];
  const { anchored, unanchored } = partitionByAnchorability(findings, byFile);
  assert(anchored.length === 1 && anchored[0].line === 8, "ligne 8 ancrée");
  assert(unanchored.length === 1 && unanchored[0].line === 99, "ligne 99 en synthèse");
  console.log("  ✓ partition : ligne 8 ancrée, ligne 99 en synthèse");

  const inline = formatInlineComment(anchored[0]);
  const summary = formatSummary(findings);
  assert(inline.includes(anchored[0].title), "commentaire en ligne contient le titre");
  assert(summary.includes(unanchored[0].title), "synthèse liste tous les findings");
  console.log("  ✓ rendu : commentaire en ligne + synthèse (source de vérité)");

  const malformed = commentableLinesInPatch("@@ -1,5 +0,1 @@\n+contenu");
  assert(malformed.size === 0, "en-tête +0 -> aucune ligne");
  console.log("  ✓ en-tête malformé (+0) -> aucune ligne commentable");
}

/** 2c. Contexte RLS / routes orphelines. */
function offlineRlsTests(): void {
  console.log("\n=== Auto-test hors-ligne (contexte RLS / routes orphelines) ===");

  const map = scanRlsMap(SAMPLE_REPO);
  assert(statusFor(map, "users") === "protected", "users protégée");
  assert(statusFor(map, "documents") === "protected", "documents protégée");
  assert(statusFor(map, "secrets") === "no_rls", "secrets orpheline (commentaire ignoré)");
  console.log("  ✓ scan : users/documents protégées, secrets orpheline");

  const orphanAcc = extractTableAccesses(filterRelevant(readFixture("orphan.diff")));
  const protAcc = extractTableAccesses(filterRelevant(readFixture("protected.diff")));
  assert(orphanAcc.some((a) => a.table === "secrets"), "orphan -> secrets");
  assert(protAcc.some((a) => a.table === "documents"), "protected -> documents");
  const ctx = serializeSecurityContext(map, orphanAcc);
  assert(/secrets[^\n]*NOT PROTECTED/i.test(ctx), "secrets NOT PROTECTED dans le contexte");
  console.log("  ✓ extraction + contexte : secrets NOT protected, documents protégée");

  const tricky = parseRls(
    `create table public.events ( id uuid primary key );
     alter table public.events enable row level security;
     create policy "read events on weekends" on public.events for select using (true);`,
  );
  assert(statusFor(tricky, "events") === "protected", "policy nommée avec « on » -> bonne table");
  assert(statusFor(tricky, "weekends") === "unknown", "pas de table parasite");
  console.log("  ✓ nom de policy contenant « on » -> attribution correcte");
}

/** 2d. Over-fetch de colonnes sensibles. */
function offlineOverfetchTests(): void {
  console.log("\n=== Auto-test hors-ligne (over-fetch de colonnes sensibles) ===");

  const over = extractSensitiveSelects(filterRelevant(readFixture("overfetch.diff")));
  assert(
    over.some((s) => s.columns.includes("password_hash") && s.table === "users"),
    "password_hash repéré sur users",
  );
  console.log("  ✓ détection : password_hash repéré (table users)");

  assert(extractSensitiveSelects(filterRelevant(readFixture("clean.diff"))).length === 0, "clean -> rien");
  const star = extractSensitiveSelects([
    { filename: "x.tsx", status: "added", additions: 1, deletions: 0, changes: 1, patch: '@@ -0,0 +1,1 @@\n+  await supabase.from("posts").select("*");' },
  ]);
  assert(star.length === 0, "select('*') -> rien");
  console.log("  ✓ anti-bruit : select('id, title') / select('*') -> rien");

  for (const anodin of ["tokens_used", "token_count", "secretary", "cvv_verified", "pwd_attempts", "ssn_verified", "email", "created_at"]) {
    assert(!isSensitiveColumn(anodin), `faux positif évité : ${anodin}`);
  }
  for (const sensible of ["password_hash", "access_token", "api_key", "private_key", "credit_card", "ssn", "secret_key"]) {
    assert(isSensitiveColumn(sensible), `colonne sensible détectée : ${sensible}`);
  }
  console.log("  ✓ segments : token_count/cvv_verified/secretary non signalés, password_hash/access_token oui");

  const findings = validateFindings({
    findings: [makeFinding("x", 1, "over", "medium", "SENSITIVE_OVERFETCH")],
  });
  assert(findings[0].category === "SENSITIVE_OVERFETCH", "catégorie SENSITIVE_OVERFETCH acceptée");
  console.log("  ✓ schéma : catégorie SENSITIVE_OVERFETCH acceptée");
}

/** 2e. Sélection / inférence du fournisseur. */
function offlineProviderTests(): void {
  console.log("\n=== Auto-test hors-ligne (sélection du fournisseur) ===");
  assert(resolveProvider("gemini", true, true).provider === "gemini", "explicite gemini");
  assert(resolveProvider("", false, true).provider === "gemini", "vide + clé gemini -> gemini");
  assert(resolveProvider("", true, false).provider === "claude", "vide + clé claude -> claude");
  assert(resolveProvider(undefined, false, false).provider === "claude", "défaut claude");
  const typo = resolveProvider("gemni", false, true);
  assert(typo.provider === "gemini" && !!typo.warning, "typo -> inférence + avertissement");
  console.log("  ✓ explicite gagne, vide -> inférence par la clé, typo -> avertissement");
}

/** 2f. Durcissement : config / blocage / plafond / marqueur. */
function offlineHardeningTests(): void {
  console.log("\n=== Auto-test (durcissement : config / blocage / plafond / marqueur) ===");

  const cfg = loadGuardianConfig(join(FIXTURES_DIR, "guardianrc"));
  assert(cfg.ignore.includes("docs/**") && cfg.failOn === "high", "config .guardianrc chargée");
  assert(isExcluded("docs/readme.md", cfg) && !isExcluded("src/index.ts", cfg), "ignore matché");
  assert(loadGuardianConfig(SAMPLE_REPO).failOn === "none", "défaut failOn=none (pas de .guardianrc)");
  console.log("  ✓ config : ignore/allowlist + défaut failOn=none");

  const medium = [makeFinding("a", 1, "m", "medium")];
  const high = [makeFinding("a", 1, "h", "high")];
  assert(!shouldBlock(medium, "high"), "medium < high -> pas de blocage");
  assert(shouldBlock(high, "high") && shouldBlock(high, "medium"), "high >= seuil -> blocage");
  assert(!shouldBlock(high, "none"), "failOn=none -> jamais");
  console.log("  ✓ blocage opt-in : seuils de sévérité corrects");

  const bulky = (n: number): ChangedFile => ({
    filename: `f${n}.ts`,
    status: "added",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: "x".repeat(500),
  });
  const { kept, truncated } = capToBudget([bulky(1), bulky(2), bulky(3)], 800);
  assert(kept.length === 1 && truncated.length === 2, "plafond appliqué");
  console.log(`  ✓ plafond de diff : ${kept.length} gardé(s), ${truncated.length} tronqué(s)`);

  assert(formatSummary([]).includes(BOT_MARKER), "synthèse marquée");
  assert(formatInlineComment(makeFinding("a", 1, "t")).includes(BOT_MARKER), "commentaire marqué");
  console.log("  ✓ idempotence : marqueur du bot détecté");
}

/** 3. Analyse réelle si la clé du fournisseur sélectionné est présente. */
async function realAnalysis(): Promise<void> {
  const provider: ProviderName =
    (process.env.LLM_PROVIDER ?? "claude").trim().toLowerCase() === "gemini" ? "gemini" : "claude";
  const config: Config = {
    githubToken: "local",
    provider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };

  const analyzer = createAnalyzer(config);
  if (!analyzer) {
    console.log(
      `\n(ℹ️ Clé absente pour le fournisseur « ${provider} » — analyse réelle ignorée. Auto-tests hors-ligne suffisants.)`,
    );
    return;
  }

  console.log(`\n=== Analyse réelle via ${analyzer.provider} (${analyzer.model}) ===`);
  for (const name of FIXTURES) {
    const { relevant, context } = loadCase(name);
    const { findings, usage } = await analyzer.analyze(relevant, context);
    console.log(`▶ ${name} -> ${findings.length} finding(s) [${usage.inputTokens}/${usage.outputTokens} tok]`);
    for (const f of findings) {
      console.log(`    • [${f.severity}] ${f.category} ${f.file}:${f.line} — ${f.title}`);
    }
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`Auto-test échoué : ${message}`);
}

async function run(): Promise<void> {
  previewFixtures();
  offlineSelfTests();
  offlineAnchorTests();
  offlineRlsTests();
  offlineOverfetchTests();
  offlineProviderTests();
  offlineHardeningTests();
  await realAnalysis();
  console.log("\n✅ Harnais local OK.");
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
