# Schema Guardian

Agent de sécurité pour la frontière **Next.js ↔ Supabase**, packagé en **GitHub Action**.
À chaque pull request, il audite l'écart entre ce que le front *demande* et ce que la base
*autorise* (policies RLS), et commente la PR.

> **Principe directeur : précision > rappel.** En cas de doute, l'agent se tait.
> Un faux positif coûte plus cher qu'un vrai positif manqué.

## État du projet

**Sprint 1 — MVP : détection `SERVICE_ROLE_LEAK`** ✅
Le pipeline complet tourne de bout en bout : `diff → filtre → analyse Claude → commentaire`.
L'agent détecte l'exposition de la clé d'admin Supabase (`service_role`) à du code atteignable
par le navigateur, et poste un commentaire de synthèse. Une seule catégorie est active ;
l'ancrage ligne par ligne et les autres détections arrivent aux sprints suivants.

Feuilles de route : [docs/sprints/sprint-0.md](docs/sprints/sprint-0.md) · [docs/sprints/sprint-1.md](docs/sprints/sprint-1.md).

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
| `src/analyzer/` | Appel Claude (`claude-sonnet-4-6`) + sortie structurée stricte (`report_findings`). |
| `src/report/`   | Mise en forme Markdown des findings. |
| `tests/`        | Harnais local + fixtures (jeu d'éval). |

## Prérequis

- Node.js ≥ 20
- Une clé API Anthropic (`ANTHROPIC_API_KEY`)

## Installation

```bash
npm install
```

## Lancer & vérifier

**Vérifier les types** (sortie attendue : `Typecheck OK`) :
```bash
npm run typecheck
```

**Itérer en local** — aperçu du filtre + auto-tests hors-ligne, sans GitHub ni clé API :
```bash
npm run test:local
```

**Test de bout en bout réel** — appelle l'API Claude (c'est le critère de réussite du Sprint 1) :
```bash
ANTHROPIC_API_KEY=sk-... npm run test:local
```
Attendu : **1 finding `critical`** sur `vulnerable.diff`, **0** sur `clean.diff`.

## Configuration en CI

1. Dans le repo GitHub : **Settings → Secrets and variables → Actions**, créer le secret
   `ANTHROPIC_API_KEY` (le `GITHUB_TOKEN` est fourni automatiquement par Actions).
2. Le workflow [`.github/workflows/security-agent.yml`](.github/workflows/security-agent.yml)
   se déclenche sur chaque `pull_request` (`opened`, `synchronize`, `reopened`).
3. Permissions du workflow : `contents: read`, `pull-requests: write` (moindre privilège).

## Roadmap

| Sprint | Contenu | Statut |
|---|---|---|
| 0 | Échafaudage, plomberie, filtre, harnais local | ✅ |
| 1 | MVP : détection `SERVICE_ROLE_LEAK` + commentaire de synthèse | ✅ |
| 2 | Ancrage des commentaires ligne par ligne | ⏳ |
| 3 | Détection RLS / route orpheline (contexte repo) | — |
| 4 | Over-fetching de colonnes sensibles | — |
| 5 | Durcissement, calibrage, idempotence, blocage opt-in | — |
