# Schema Guardian

Agent de sécurité pour la frontière **Next.js ↔ Supabase**, packagé en **GitHub Action**.
À chaque pull request, il audite l'écart entre ce que le front *demande* et ce que la base
*autorise* (policies RLS), et commente la PR.

> **Principe directeur : précision > rappel.** En cas de doute, l'agent se tait.
> Un faux positif coûte plus cher qu'un vrai positif manqué.

## État du projet — v1.0 ✅

Les **5 sprints** du plan sont terminés. Schema Guardian v1.0 :

- détecte **trois classes de failles** à la frontière Next.js ↔ Supabase :
  `SERVICE_ROLE_LEAK` (`critical`) · `ORPHAN_TABLE_ACCESS` (`high`) · `SENSITIVE_OVERFETCH` (`medium`) ;
- raisonne sur le **dépôt entier** (scan RLS des migrations), pas seulement sur le diff ;
- commente **ligne par ligne**, de façon **idempotente** (une seule revue vivante, jamais d'empilement) ;
- est **configurable** par dépôt (`.guardianrc.json`) et peut **bloquer** une PR au-delà d'un seuil de sévérité ;
- est calibré sur un **jeu d'éval** (11 fixtures) mesurant précision et rappel.

**Multi-fournisseur** : Claude *ou* Gemini, commutable via `LLM_PROVIDER`.

Feuilles de route : [sprint-0](docs/sprints/sprint-0.md) · [1](docs/sprints/sprint-1.md) · [2](docs/sprints/sprint-2.md) · [3](docs/sprints/sprint-3.md) · [4](docs/sprints/sprint-4.md) · [5](docs/sprints/sprint-5.md).

## Architecture

```
PR ouverte / mise à jour (push)
        │
        ▼
GitHub Action ──► COLLECTOR ──► ANALYZER (Claude) ──► REPORTER ──► Review postée sur la PR
                  (contexte)    (findings JSON)       (commentaires)
```

| Dossier | Rôle |
|---|---|
| `src/github/` | Client Octokit, lecture de la PR, publication des commentaires. |
| `src/context/` | Filtre de pertinence + scan RLS du dépôt (`rls.ts`) + collecte des accès `from()` (`collector.ts`). |
| `src/analyzer/` | Interface multi-fournisseur (`Analyzer`) + implémentations `providers/{claude,gemini}.ts` + contrat Zod partagé. |
| `src/report/`   | Mise en forme Markdown des findings (synthèse + commentaires ancrés). |
| `src/guardian-config.ts` | Config `.guardianrc` (`ignore`, `failOn`, `maxDiffChars`). |
| `tests/`        | Harnais local + **jeu d'éval** (`eval.ts`) + fixtures. |

## Prérequis

- Node.js ≥ 20
- Une clé API selon le fournisseur choisi : `ANTHROPIC_API_KEY` (Claude) **ou** `GEMINI_API_KEY` (Gemini, Google AI Studio)

## Installation

```bash
npm install
```

## Choisir le fournisseur LLM

L'analyse passe par une interface multi-fournisseur. On choisit l'implémentation via la
variable d'environnement `LLM_PROVIDER` ; le reste du pipeline est identique.

| `LLM_PROVIDER` | Clé requise | Modèle par défaut (surcharge) |
|---|---|---|
| `claude` (défaut) | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` (`CLAUDE_MODEL`) |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.5-flash` (`GEMINI_MODEL`) |

> Le contrat de sortie (`ReportSchema` Zod) est commun : changer de fournisseur ne change
> rien au reste du code. **Re-valider la précision sur les fixtures à chaque changement** —
> c'est la contrainte n°1 du projet (zéro faux positif).

## Lancer & vérifier

**Vérifier les types** (sortie attendue : `Typecheck OK`) :
```bash
npm run typecheck
```

**Itérer en local** — aperçu du filtre + auto-tests hors-ligne, sans GitHub ni clé API :
```bash
npm run test:local
```

**Test de bout en bout réel** — appelle le LLM du fournisseur sélectionné (critère de réussite) :
```bash
# Claude (défaut)
ANTHROPIC_API_KEY=sk-ant-... npm run test:local

# Gemini
LLM_PROVIDER=gemini GEMINI_API_KEY=... npm run test:local
```
Attendu : **1 finding `critical`** sur `vulnerable.diff`, **0** sur `clean.diff` — quel que soit le fournisseur.

**Jeu d'éval** — précision / rappel sur les 11 fixtures (le critère de calibrage) :
```bash
npm run eval                         # hors-ligne : vérifie le chargement + affiche les attendus
ANTHROPIC_API_KEY=sk-ant-... npm run eval   # réel : mesure précision (0 FP visé) et rappel
```

## Configuration (`.guardianrc.json`)

Optionnel, à la racine du dépôt audité (voir [`.guardianrc.example.json`](.guardianrc.example.json)) :

```json
{
  "ignore": ["docs/**", "**/*.test.ts", "src/lib/server-only/**"],
  "failOn": "none",
  "maxDiffChars": 60000
}
```

| Clé | Rôle | Défaut |
|---|---|---|
| `ignore` | Globs de fichiers jamais analysés. | `[]` |
| `failOn` | Seuil de **blocage** de la PR : `none` \| `info` \| `medium` \| `high` \| `critical`. | `none` |
| `maxDiffChars` | Plafond de diff envoyé au LLM (au-delà : troncature signalée). | `60000` |

> `allowlist` est un alias **déprécié** d'`ignore` (comportement identique) : encore lu et fusionné dans `ignore`, mais à migrer.

> **`failOn: "none"` par défaut = fail open** : l'agent commente, il ne bloque pas — sauf activation explicite.
> Le commentaire de synthèse est **idempotent** (mis à jour en place) ; les commentaires ancrés obsolètes sont supprimés puis recréés à chaque push.
>
> 🔒 **La config est lue depuis la branche _base_ de la PR** (état déjà revu), jamais depuis le
> diff de la PR : une PR ne peut donc pas désactiver le blocage ou s'auto-exclure en modifiant
> `.guardianrc.json` dans son propre commit. Modifier la config exige donc un merge sur la base.

## Configuration en CI

1. Dans le repo GitHub : **Settings → Secrets and variables → Actions**, créer le secret du
   fournisseur (`ANTHROPIC_API_KEY` ou `GEMINI_API_KEY`) et, pour Gemini, la *variable*
   `LLM_PROVIDER=gemini` (le `GITHUB_TOKEN` est fourni automatiquement par Actions).
2. Le workflow [`.github/workflows/security-agent.yml`](.github/workflows/security-agent.yml)
   se déclenche sur chaque `pull_request` (`opened`, `synchronize`, `reopened`).
3. Permissions du workflow : `contents: read`, `pull-requests: write` (moindre privilège).

## Roadmap

| Sprint | Contenu | Statut |
|---|---|---|
| 0 | Échafaudage, plomberie, filtre, harnais local | ✅ |
| 1 | MVP : détection `SERVICE_ROLE_LEAK` + commentaire de synthèse | ✅ |
| 2 | Ancrage des commentaires ligne par ligne | ✅ |
| 3 | Détection RLS / route orpheline (contexte repo) | ✅ |
| 4 | Over-fetching de colonnes sensibles | ✅ |
| 5 | Durcissement, calibrage, idempotence, blocage opt-in (v1.0) | ✅ |

**Pistes v1.1+ :** export SARIF (GitHub code scanning), commentaires de suppression
(`// guardian-ignore`), chunking pour très gros diffs, fail-soft sur erreur LLM transitoire,
nouvelles catégories (buckets Storage publics, RPC/Edge Functions non sécurisées).
