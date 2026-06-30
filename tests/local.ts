import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filterRelevant } from "../src/context/filter";
import { validateFindings } from "../src/analyzer/schema";
import { createAnalyzer } from "../src/analyzer/provider";
import { resolveProvider } from "../src/config";
import {
  formatSummary,
  formatInlineComment,
  formatReviewSummary,
} from "../src/report/formatter";
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
import type { ChangedFile, Finding } from "../src/types";
import type { Config, ProviderName } from "../src/config";

/**
 * Harnais de test local (Sprint 2).
 *
 *  1. Aperçu du filtre sur chaque fixture (sans GitHub ni LLM).
 *  2. Auto-tests hors-ligne : parsing/validation/rendu (Sprint 1) + ancrage (Sprint 2).
 *  3. Analyse RÉELLE via le fournisseur sélectionné si sa clé est présente.
 */

const FIXTURES = [
  "vulnerable.diff",
  "clean.diff",
  "orphan.diff",
  "protected.diff",
  "overfetch.diff",
];

/** Parseur de diff unifié minimal : reconstruit fidèlement le `patch` de chaque fichier. */
function parseDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;
  let patchLines: string[] = [];

  const flush = (): void => {
    if (!current) return;
    current.patch = patchLines.join("\n");
    current.changes = current.additions + current.deletions;
    files.push(current);
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      patchLines = [];
      const match = line.match(/ b\/(.+)$/);
      current = {
        filename: match ? match[1] : "unknown",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 0,
        patch: "",
      };
      continue;
    }

    if (!current) continue;

    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("rename ") ||
      line.startsWith("similarity ")
    ) {
      continue;
    }

    // On conserve l'en-tête de hunk et les lignes +/-/contexte dans le patch
    // (c'est ce que `diff.ts` consomme pour calculer les lignes commentables).
    if (line.startsWith("@@")) {
      patchLines.push(line);
    } else if (line.startsWith("+")) {
      current.additions++;
      patchLines.push(line);
    } else if (line.startsWith("-")) {
      current.deletions++;
      patchLines.push(line);
    } else {
      patchLines.push(line);
    }
  }

  flush();
  return files;
}

const here = dirname(fileURLToPath(import.meta.url));

function readFixture(name: string): ChangedFile[] {
  return parseDiff(readFileSync(join(here, "fixtures", name), "utf8"));
}

/** Fabrique un finding minimal pour les tests. */
function makeFinding(file: string, line: number, title: string): Finding {
  return {
    category: "SERVICE_ROLE_LEAK",
    severity: "critical",
    file,
    line,
    title,
    explanation: "Exposition de la clé service_role au navigateur.",
    suggested_fix: "Déplacer l'accès côté serveur ; utiliser la clé anon côté client.",
  };
}

/** 1. Aperçu du filtre par fixture. */
function previewFixtures(): void {
  for (const name of FIXTURES) {
    const files = readFixture(name);
    const relevant = filterRelevant(files);
    console.log(`▶ Fixture : ${name}`);
    console.log(
      `  fichiers modifiés : ${files.length} | pertinents : ${relevant.length}`,
    );
    for (const f of relevant) console.log(`    ✓ ${f.filename}`);
  }
}

const SAMPLE_TOOL_RESPONSE = {
  findings: [makeFinding("app/dashboard/UserList.tsx", 8, "Clé service_role exposée")],
};

/** 2a. Auto-tests hors-ligne — parsing / validation / rendu (Sprint 1). */
function offlineSelfTests(): void {
  console.log("\n=== Auto-test hors-ligne (parse + validation + rendu) ===");

  const findings = validateFindings(SAMPLE_TOOL_RESPONSE);
  assert(findings.length === 1, "1 finding attendu");
  assert(findings[0].severity === "critical", "sévérité critical attendue");
  assert(
    formatSummary(findings).includes("Critique"),
    "le rendu Markdown doit contenir la sévérité",
  );
  console.log("  ✓ réponse outillée -> 1 finding critical, rendu Markdown OK");

  const empty = validateFindings({ findings: [] });
  assert(empty.length === 0, "0 finding attendu");
  assert(formatSummary(empty).includes("Aucune fuite"), "le commentaire vide doit rassurer");
  console.log("  ✓ réponse vide -> commentaire « aucune fuite »");

  let rejected = false;
  try {
    validateFindings({ findings: [{ category: "NOPE", severity: "boom" }] });
  } catch {
    rejected = true;
  }
  assert(rejected, "une réponse non conforme doit être rejetée");
  console.log("  ✓ réponse non conforme -> rejetée");
}

/** 2b. Auto-tests hors-ligne — ancrage ligne par ligne (Sprint 2). */
function offlineAnchorTests(): void {
  console.log("\n=== Auto-test hors-ligne (ancrage ligne par ligne) ===");

  const byFile = commentableLinesByFile(readFixture("vulnerable.diff"));
  const ul = byFile.get("app/dashboard/UserList.tsx");
  assert(!!ul, "UserList.tsx présent dans la carte");
  assert(ul!.size === 16 && ul!.has(8), "16 lignes commentables dont la 8");
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
  const summary = formatReviewSummary(unanchored, findings.length);
  assert(inline.includes(anchored[0].title), "le commentaire en ligne contient le titre");
  assert(summary.includes(unanchored[0].title), "la synthèse liste le non-ancré");
  console.log("  ✓ rendu : commentaire en ligne + synthèse des non-ancrés");

  // Garde-fou : un en-tête `+0` ne doit jamais produire de ligne 0 (sinon 422).
  const malformed = commentableLinesInPatch("@@ -1,5 +0,1 @@\n+contenu");
  assert(malformed.size === 0, "un en-tête +0 ne doit produire aucune ligne");
  console.log("  ✓ en-tête malformé (+0) -> aucune ligne commentable");
}

/** 3. Analyse réelle si la clé du fournisseur sélectionné est présente. */
async function realAnalysis(): Promise<void> {
  const provider: ProviderName =
    (process.env.LLM_PROVIDER ?? "claude").trim().toLowerCase() === "gemini"
      ? "gemini"
      : "claude";

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
  const rlsMap = scanRlsMap(join(here, "fixtures", "sample-repo"));
  for (const name of FIXTURES) {
    const relevant = filterRelevant(readFixture(name));
    const accesses = extractTableAccesses(relevant);
    const sensitive = extractSensitiveSelects(relevant);
    const context =
      accesses.length > 0 || sensitive.length > 0
        ? serializeSecurityContext(rlsMap, accesses, sensitive)
        : undefined;
    const findings = await analyzer.analyze(relevant, context);
    console.log(`▶ ${name} -> ${findings.length} finding(s)`);
    for (const f of findings) {
      console.log(`    • [${f.severity}] ${f.category} ${f.file}:${f.line} — ${f.title}`);
    }
  }
}

/** 2c. Auto-tests hors-ligne — contexte RLS / routes orphelines (Sprint 3). */
function offlineRlsTests(): void {
  console.log("\n=== Auto-test hors-ligne (contexte RLS / routes orphelines) ===");

  const map = scanRlsMap(join(here, "fixtures", "sample-repo"));
  assert(map.size === 4, "4 tables scannées");
  assert(statusFor(map, "users") === "protected", "users protégée");
  assert(statusFor(map, "notes") === "protected", "notes protégée");
  assert(statusFor(map, "documents") === "protected", "documents protégée");
  // Le `alter table secrets enable rls` est en commentaire -> doit rester no_rls.
  assert(statusFor(map, "secrets") === "no_rls", "secrets orpheline (commentaire ignoré)");
  console.log("  ✓ scan : 4 tables (users/notes/documents protégées, secrets orpheline)");

  const orphanAcc = extractTableAccesses(filterRelevant(readFixture("orphan.diff")));
  const protAcc = extractTableAccesses(filterRelevant(readFixture("protected.diff")));
  assert(orphanAcc.some((a) => a.table === "secrets"), "orphan -> secrets");
  assert(protAcc.some((a) => a.table === "documents"), "protected -> documents");
  console.log("  ✓ extraction du diff : orphan -> secrets, protected -> documents");

  const ctxOrphan = serializeSecurityContext(map, orphanAcc);
  const ctxProt = serializeSecurityContext(map, protAcc);
  assert(/secrets[^\n]*NOT PROTECTED/i.test(ctxOrphan), "secrets NOT PROTECTED dans le contexte");
  assert(/`documents`[^\n]*-> PROTECTED/i.test(ctxProt), "documents PROTECTED dans le contexte");
  console.log("  ✓ contexte sérialisé : secrets signalée NOT protected, documents protégée");

  // Garde-fou : un nom de policy contenant « on » ne doit pas détourner la table.
  const tricky = parseRls(
    `create table public.events ( id uuid primary key );
     alter table public.events enable row level security;
     create policy "read events on weekends" on public.events for select using (true);`,
  );
  assert(statusFor(tricky, "events") === "protected", "policy nommée avec « on » -> bonne table");
  assert(statusFor(tricky, "weekends") === "unknown", "pas de table parasite « weekends »");
  console.log("  ✓ nom de policy contenant « on » -> attribution correcte (pas de table parasite)");
}

/** 2d. Auto-tests hors-ligne — over-fetch de colonnes sensibles (Sprint 4). */
function offlineOverfetchTests(): void {
  console.log("\n=== Auto-test hors-ligne (over-fetch de colonnes sensibles) ===");

  const over = extractSensitiveSelects(filterRelevant(readFixture("overfetch.diff")));
  assert(
    over.some((s) => s.columns.includes("password_hash") && s.table === "users"),
    "password_hash repéré sur users",
  );
  console.log("  ✓ détection : password_hash repéré (table users)");

  // Anti-bruit : colonnes anodines et `select('*')` ne doivent rien remonter.
  assert(
    extractSensitiveSelects(filterRelevant(readFixture("clean.diff"))).length === 0,
    "select('id, title') ne remonte rien",
  );
  const star = extractSensitiveSelects([
    {
      filename: "x.tsx",
      status: "added",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: '@@ -0,0 +1,1 @@\n+  await supabase.from("posts").select("*");',
    },
  ]);
  assert(star.length === 0, "select('*') ne remonte rien");
  console.log("  ✓ anti-bruit : select('id, title') -> rien");

  // Faux positifs (matching par segments) : noms anodins contenant un motif sensible.
  for (const anodin of [
    "tokens_used",
    "token_count",
    "secretary",
    "cvv_verified",
    "cvc_validated",
    "pwd_attempts",
    "ssn_verified",
    "email",
    "created_at",
    "id",
  ]) {
    assert(!isSensitiveColumn(anodin), `faux positif évité : ${anodin}`);
  }
  // Vrais positifs : doivent rester détectés.
  for (const sensible of [
    "password_hash",
    "password",
    "access_token",
    "refresh_token",
    "api_key",
    "private_key",
    "credit_card",
    "ssn",
    "cvv",
    "secret",
    "secret_key",
    "mfa_secret",
  ]) {
    assert(isSensitiveColumn(sensible), `colonne sensible détectée : ${sensible}`);
  }
  console.log("  ✓ segments : token_count/cvv_verified/secretary non signalés, password_hash/access_token oui");

  // Chaînage from()/select() sur des lignes séparées -> table associée.
  const chained = extractSensitiveSelects([
    {
      filename: "y.tsx",
      status: "added",
      additions: 2,
      deletions: 0,
      changes: 2,
      patch: '@@ -0,0 +1,2 @@\n+  const q = supabase.from("accounts")\n+    .select("id, api_key");',
    },
  ]);
  assert(
    chained.some((s) => s.table === "accounts" && s.columns.includes("api_key")),
    "from()/select() chaînés -> table associée",
  );
  console.log("  ✓ chaînage from()/.select() multi-lignes -> table associée");

  const findings = validateFindings({
    findings: [
      {
        category: "SENSITIVE_OVERFETCH",
        severity: "medium",
        file: "app/profile/UserCard.tsx",
        line: 11,
        title: "Over-fetch de password_hash",
        explanation: "La colonne password_hash est tirée vers le client.",
        suggested_fix: "select('id, email')",
      },
    ],
  });
  assert(
    findings.length === 1 && findings[0].category === "SENSITIVE_OVERFETCH",
    "catégorie SENSITIVE_OVERFETCH acceptée par le schéma",
  );
  console.log("  ✓ schéma : catégorie SENSITIVE_OVERFETCH acceptée");
}

/** 2e. Auto-tests hors-ligne — sélection / inférence du fournisseur. */
function offlineProviderTests(): void {
  console.log("\n=== Auto-test hors-ligne (sélection du fournisseur) ===");

  assert(resolveProvider("gemini", true, true).provider === "gemini", "valeur explicite gemini");
  assert(resolveProvider("CLAUDE", false, false).provider === "claude", "valeur explicite claude (casse)");
  // Variable vide (variable GitHub non définie) -> inférence depuis la clé présente.
  assert(resolveProvider("", false, true).provider === "gemini", "vide + clé gemini -> gemini");
  assert(resolveProvider("", true, false).provider === "claude", "vide + clé claude -> claude");
  assert(resolveProvider(undefined, false, false).provider === "claude", "absent + aucune clé -> claude");
  const typo = resolveProvider("gemni", false, true);
  assert(typo.provider === "gemini" && !!typo.warning, "typo -> inférence + avertissement");
  console.log("  ✓ explicite gagne, vide -> inférence par la clé, typo -> inférence + avertissement");
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
  await realAnalysis();
  console.log("\n✅ Harnais local OK.");
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
