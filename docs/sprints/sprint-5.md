# Sprint 5 — Durcissement, calibrage & DX (v1.0)

> **Projet :** Schema Guardian — agent de sécurité pour la frontière Next.js ↔ Supabase.
> **Statut :** ✅ Terminé et vérifié (typecheck + auto-tests hors-ligne ; métriques d'éval à mesurer avec une clé API).

---

## 🎯 Objectif

Le sprint qui rend l'agent **adoptable en équipe réelle** et fait passer le projet en **v1.0** :
ne pas spammer les PR (idempotence), se configurer par dépôt (`.guardianrc`), bloquer au-delà
d'un seuil de gravité (opt-in), survivre aux gros diffs, journaliser les coûts, et **mesurer la
précision** sur un vrai jeu d'évaluation.

---

## ✅ Definition of Done

- [x] **Calibrage faux positifs :** jeu d'éval de 11 fixtures + métriques précision / rappel (`npm run eval`).
- [x] **Idempotence :** marqueur HTML caché ; synthèse **upsertée** en place ; commentaires ancrés obsolètes **supprimés puis recréés**.
- [x] **Diffs volumineux :** plafond `maxDiffChars` + troncature **signalée** dans la synthèse.
- [x] **Coût :** tokens in/out journalisés (renvoyés par `analyze`) ; LLM appelé seulement si fichiers pertinents.
- [x] **Config `.guardianrc` :** `ignore`, `allowlist`, `failOn`, `maxDiffChars` (matcher de globs maison).
- [x] **Blocage opt-in :** `core.setFailed` si un finding atteint `failOn` (défaut `none` = fail open).
- [x] **README** complet (config, secrets, CI, éval).

---

## 🗂️ Livrable — fichiers ajoutés / modifiés

| Fichier | Statut | Rôle |
|---|---|---|
| `src/guardian-config.ts` | **nouveau** | `.guardianrc` : globs `ignore`/`allowlist`, seuil `failOn`, `maxDiffChars`. |
| `src/context/budget.ts` | **nouveau** | Plafond de diff (`capToBudget` → gardés / tronqués). |
| `tests/_fixture.ts` | **nouveau** | Utilitaires de chargement partagés (local + éval). |
| `tests/eval.ts` | **nouveau** | Jeu d'éval : précision / rappel sur 11 fixtures (hors-ligne : cohérence). |
| `tests/fixtures/*.diff` | **nouveau** | 6 fixtures : `multi-issue`, `server-service-role`, `wildcard-select`, `mention-only`, `unknown-table`, `rls-no-policy`. |
| `tests/fixtures/sample-repo/.../0003_audit.sql` | **nouveau** | `audit_log` : RLS sans policy (deny-all, cas gris). |
| `.guardianrc.example.json`, `tests/fixtures/guardianrc/.guardianrc.json` | **nouveau** | Exemple + config de test. |
| `src/github/review.ts` | **modifié** | Idempotence : `upsertSummaryComment`, `deleteBotReviewComments`, `postInlineComment`. |
| `src/analyzer/provider.ts` + `providers/{claude,gemini}.ts` | **modifié** | `analyze` renvoie `{ findings, usage }` (coût en tokens). |
| `src/index.ts` | **modifié** | Câblage complet : config, exclusions, plafond, idempotence, blocage, coûts. |
| `src/report/formatter.ts` | **modifié** | `formatSummary` avec pied de page (troncature / coût / blocage). |
| `tests/local.ts` | **modifié** | Utilitaires partagés + auto-test de durcissement. |
| `README.md`, `package.json` | **modifié** | Doc v1.0, script `eval`, version `1.0.0`. |

> Adapté à l'architecture multi-fournisseur : l'idempotence passe par des **commentaires ancrés
> individuels** (`pulls.createReviewComment`) supprimés/recréés, + une **synthèse upsertée** (commentaire
> d'issue) qui reste la source de vérité. Version `1.0.0` (le plan indiquait `0.5.0`, déjà pris par le Sprint 3).

---

## 🧠 Décisions techniques (et pourquoi)

- **Idempotence en deux mécanismes.** Marqueur HTML caché (`<!-- schema-guardian -->`) sur tout ce
  que poste le bot. La synthèse est **mise à jour en place** (upsert) ; les commentaires ancrés,
  non éditables, sont **supprimés puis recréés** à chaque push. Une seule revue vivante.
- **La synthèse upsertée est la source de vérité.** Si un ancrage échoue (422), le finding reste
  visible dans la synthèse — l'information n'est jamais perdue.
- **Plafond plutôt que chunking.** Plus simple/robuste pour une v1 : on tronque au-delà du budget
  et on **signale**, jamais en silence.
- **`failOn = none` par défaut (fail open).** L'agent commente, il ne bloque pas — sauf activation
  explicite par l'équipe.
- **Jeu d'éval qui distingue faux positif et finding légitime.** Chaque fixture déclare `mustFind`
  (rappel), `allow` (catégories légitimes) et `maxSeverity`. Les cas **gris** (table inconnue,
  RLS sans policy) tolèrent un `info` mais jamais un `medium`/`high` — précision sans pénaliser la prudence.
- **Matcher de globs maison.** Pas de dépendance ajoutée pour `ignore`/`allowlist`.

---

## ▶️ Lancer & vérifier

```bash
npm install
npm run typecheck     # -> Typecheck OK
npm run test:local    # auto-tests (validation, ancrage, RLS, over-fetch, fournisseur, durcissement)
npm run eval          # hors-ligne : cohérence des 11 fixtures
ANTHROPIC_API_KEY=sk-... npm run eval   # réel : précision (0 FP visé) et rappel
```

Auto-test de durcissement (extrait attendu) :
```
=== Auto-test (durcissement : config / blocage / plafond / marqueur) ===
  ✓ config : ignore/allowlist + défaut failOn=none
  ✓ blocage opt-in : seuils de sévérité corrects
  ✓ plafond de diff : 1 gardé(s), 2 tronqué(s)
  ✓ idempotence : marqueur du bot détecté
```

Jeu d'éval (11 fixtures) :

| Type | Fixtures | Attendu |
|---|---|---|
| Positives | `vulnerable`, `orphan`, `overfetch`, `multi-issue` | les catégories correspondantes |
| Négatives | `clean`, `protected`, `server-service-role`, `wildcard-select`, `mention-only` | aucun finding |
| Grises | `unknown-table`, `rls-no-policy` | au plus `info` (jamais `high`/`medium`) |

---

## 🏁 Clôture

Les **5 sprints du plan sont terminés** — Schema Guardian **v1.0**. Pistes v1.1+ : export SARIF,
commentaires de suppression (`// guardian-ignore`), chunking pour très gros diffs, fail-soft sur
erreur LLM transitoire (503/429), nouvelles catégories (buckets Storage publics, RPC/Edge Functions
non sécurisées, Server Actions sans contrôle d'accès), et un jeu d'éval élargi pour suivre la précision.
