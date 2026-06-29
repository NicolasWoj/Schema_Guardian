# Schema Guardian

Agent de sécurité pour la frontière **Next.js ↔ Supabase**, packagé en **GitHub Action**.
À chaque pull request, il audite l'écart entre ce que le front *demande* et ce que la base
*autorise* (policies RLS), et commente la PR.

> **Principe directeur : précision > rappel.** En cas de doute, l'agent se tait.
> Un faux positif coûte plus cher qu'un vrai positif manqué.

## État du projet

**Sprint 2 — Revue ancrée ligne par ligne** ✅
Le pipeline détecte l'exposition de la clé d'admin Supabase (`service_role`) et poste une
**revue ancrée** : chaque finding apparaît directement sur la ligne concernée de la PR
(`pulls.createReview`, `side: "RIGHT"`). Garde-fou anti-422 en deux couches — les findings
hors-diff basculent en synthèse et tout refus d'ancrage déclenche un repli automatique.
Une seule catégorie est active ; les autres détections arrivent aux sprints suivants.

Feuilles de route : [sprint-0](docs/sprints/sprint-0.md) · [sprint-1](docs/sprints/sprint-1.md) · [sprint-2](docs/sprints/sprint-2.md).

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
| `src/context/` | Filtre de pertinence (et, plus tard, carte RLS du repo). |
| `src/analyzer/` | Interface multi-fournisseur (`Analyzer`) + implémentations `providers/{claude,gemini}.ts` + contrat Zod partagé. |
| `src/report/`   | Mise en forme Markdown des findings. |
| `tests/`        | Harnais local + fixtures (jeu d'éval). |

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
| 3 | Détection RLS / route orpheline (contexte repo) | ⏳ |
| 4 | Over-fetching de colonnes sensibles | — |
| 5 | Durcissement, calibrage, idempotence, blocage opt-in | — |
