# Schema Guardian

Agent de sécurité pour la frontière **Next.js ↔ Supabase**, packagé en **GitHub Action**.
À chaque pull request, il audite l'écart entre ce que le front *demande* et ce que la base
*autorise* (policies RLS), et commente la PR.

> **Principe directeur : précision > rappel.** En cas de doute, l'agent se tait.
> Un faux positif coûte plus cher qu'un vrai positif manqué.

## État du projet

**Sprint 0 — Fondations & échafaudage** ✅
La plomberie de bout en bout fonctionne (payload PR → Octokit → liste des fichiers →
filtre de pertinence → commentaire posté). **Aucune analyse LLM n'est encore branchée** :
l'action poste un commentaire de vie « Schema Guardian actif ✅ » listant les fichiers retenus.

Voir la feuille de route détaillée dans [docs/sprints/sprint-0.md](docs/sprints/sprint-0.md).

## Architecture (cible)

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
| `src/analyzer/` | Appel Claude + sortie structurée *(Sprint 1)*. |
| `src/report/`   | Mise en forme des findings *(Sprint 1)*. |
| `tests/`        | Harnais local + fixtures (jeu d'éval). |

## Prérequis

- Node.js ≥ 20
- Une clé API Anthropic (utilisée à partir du Sprint 1)

## Installation

```bash
npm install
```

## Lancer & vérifier

**Vérifier les types** (sortie attendue : `Typecheck OK`) :
```bash
npm run typecheck
```

**Itérer en local** — rejoue un diff de fixture, sans GitHub ni clé API :
```bash
npm run test:local
```
Sortie attendue :
```
Fichiers modifiés (2) :
  - app/dashboard/UserList.tsx (+15/-0)
  - README.md (+1/-0)

Fichiers pertinents pour l'audit (1) :
  ✓ app/dashboard/UserList.tsx

✅ Plomberie locale OK.
```

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
| 1 | MVP : détection `SERVICE_ROLE_LEAK` + commentaire de synthèse | ⏳ |
| 2 | Ancrage des commentaires ligne par ligne | — |
| 3 | Détection RLS / route orpheline (contexte repo) | — |
| 4 | Over-fetching de colonnes sensibles | — |
| 5 | Durcissement, calibrage, idempotence, blocage opt-in | — |
