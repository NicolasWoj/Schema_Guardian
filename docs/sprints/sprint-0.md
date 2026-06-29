# Sprint 0 — Fondations & échafaudage

> **Projet :** Schema Guardian — agent de sécurité pour la frontière Next.js ↔ Supabase.
> **Statut :** ✅ Terminé et vérifié.

---

## 🎯 Objectif

Valider la **plomberie de bout en bout** avant d'écrire la moindre logique d'analyse.
À la fin du sprint, le squelette s'exécute en CI et poste un commentaire de vie sur
chaque pull request. Aucune IA n'est encore branchée : on s'assure d'abord que la
chaîne `payload PR → Octokit → liste des fichiers → filtre → commentaire posté`
fonctionne, pour ne pas déboguer la plomberie et le LLM en même temps au Sprint 1.

---

## 📦 Périmètre

### Dans ce sprint
- Projet TypeScript exécutable (ESM, lancé via `tsx`, sans étape de build en CI).
- Workflow GitHub Action déclenché sur les pull requests.
- Client Octokit authentifié + lecture du contexte PR depuis le payload.
- Récupération des fichiers modifiés (avec leur `patch`).
- **Filtre de pertinence** déjà fonctionnel (le levier de coût n°1).
- Publication d'un commentaire de synthèse sur la PR.
- Harnais de test local qui rejoue un diff de fixture **sans GitHub ni LLM**.

### Hors de ce sprint (reporté)
- Appel au LLM et détection de failles → **Sprint 1**.
- Ancrage des commentaires ligne par ligne → **Sprint 2**.
- Scan RLS du repo (routes orphelines) → **Sprint 3**.
- Over-fetching de colonnes sensibles → **Sprint 4**.
- Idempotence des commentaires, calibrage, blocage de PR → **Sprint 5**.

---

## ✅ Definition of Done

- [x] `package.json` + `tsconfig.json` ; le projet compile (`tsc --noEmit`).
- [x] Arborescence en place (`src/`, `src/github/`, `src/context/`, `tests/`).
- [x] `security-agent.yml` déclenché sur `pull_request` (`opened`, `synchronize`, `reopened`).
- [x] Permissions du workflow : `contents: read`, `pull-requests: write`.
- [x] Secret `ANTHROPIC_API_KEY` documenté ; `GITHUB_TOKEN` câblé.
- [x] Octokit initialisé avec `GITHUB_TOKEN` ; numéro de PR lu depuis le payload.
- [x] Harnais de test local qui rejoue un diff de fixture sans appeler GitHub.
- [x] **Test :** sur une PR, l'agent poste « Schema Guardian actif ✅ » avec la liste des fichiers retenus.

---

## 🗂️ Livrable — carte des fichiers

| Fichier | Rôle |
|---|---|
| `.github/workflows/security-agent.yml` | Déclencheur CI sur les PR (permissions, install, exécution via `tsx`). |
| `src/index.ts` | Point d'entrée : orchestre la plomberie et poste le commentaire de vie. |
| `src/config.ts` | Lecture/validation des secrets (`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`), fail-fast. |
| `src/types.ts` | Types partagés (`Finding`, `ChangedFile`, `Severity`) — anticipent les sprints suivants. |
| `src/github/client.ts` | Initialise le client Octokit. |
| `src/github/pr.ts` | Référence de la PR depuis le payload + liste des fichiers modifiés. |
| `src/github/review.ts` | Poste un commentaire de synthèse sur la PR. |
| `src/context/filter.ts` | Ne garde que les fichiers pertinents pour l'audit (levier de coût). |
| `tests/local.ts` | Harnais local : rejoue un diff de fixture, sans GitHub ni LLM. |
| `tests/fixtures/sample.diff` | Diff d'exemple — fixture **positive** (fuite de `service_role`) + fichier anodin. |
| `package.json`, `tsconfig.json` | Config projet. |
| `.env.example`, `.gitignore`, `README.md` | Modèle de secrets, exclusions Git, documentation. |

---

## 🧠 Décisions techniques (et pourquoi)

- **Exécution via `tsx`, pas de build en CI.** Le workflow lance directement
  `npx tsx src/index.ts`. Une étape de compilation en moins = un point de panne en moins.
- **ESM + résolution `Bundler`.** Les imports sont sans extension de fichier
  (`import { ... } from "./config"`). `tsc` les valide, `tsx` les résout au runtime.
- **`getOctokit` plutôt qu'`@octokit/rest` brut.** Le client fourni par `@actions/github`
  embarque déjà REST, GraphQL et la pagination, avec l'auth câblée.
- **Le filtre de pertinence est livré dès le Sprint 0.** C'est lui qui garantira au
  Sprint 1 qu'on n'appelle l'API que si des fichiers Supabase/SQL sont touchés.
- **Config en fail-fast.** Sans `GITHUB_TOKEN`, on échoue immédiatement ;
  `ANTHROPIC_API_KEY` ne déclenche qu'un avertissement (pas encore utilisé).
- **Fixture positive dès maintenant.** `sample.diff` contient déjà une vraie fuite de
  `service_role` : cas de test du Sprint 1 et socle du jeu d'éval du Sprint 5.

---

## ▶️ Lancer & vérifier

```bash
npm install
npm run typecheck   # -> Typecheck OK
npm run test:local  # -> liste des fichiers + "✅ Plomberie locale OK."
```

En CI, sur une PR de test : le workflow installe les dépendances, exécute l'agent,
qui poste « Schema Guardian actif ✅ ». Hors contexte PR, l'entrypoint sort
proprement (`Aucune pull_request dans le contexte`, code 0).

---

## ⚠️ Limites connues (dette assumée)

- **Commentaire non idempotent.** Un nouveau commentaire est ajouté à chaque push. → **Sprint 5**.
- **Pas d'analyse ligne par ligne.** Le `patch` est récupéré mais pas parsé. → **Sprint 2**.
- **Filtre heuristique.** Basé sur des indices textuels. Suffisant comme garde-coût.

---

## ➡️ Passage au Sprint 1

Le Sprint 1 remplace le bloc « message de vie » de `src/index.ts` par la vraie analyse :
brancher Claude (`claude-sonnet-4-6`) avec un system prompt limité à `SERVICE_ROLE_LEAK`,
récupérer les findings en sortie structurée (`report_findings`, strict tool use), les
transformer en commentaire de synthèse, et vérifier **zéro faux positif** sur une PR propre.
Le câblage est déjà prêt : `src/context/filter.ts` alimente l'analyzer, `src/github/review.ts`
porte la synthèse.
