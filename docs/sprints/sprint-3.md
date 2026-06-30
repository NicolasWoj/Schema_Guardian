# Sprint 3 — Détection des routes orphelines (contexte RLS du repo)

> **Projet :** Schema Guardian — agent de sécurité pour la frontière Next.js ↔ Supabase.
> **Statut :** ✅ Terminé et vérifié (typecheck + auto-tests hors-ligne ; test réel à lancer avec une clé API).

---

## 🎯 Objectif

La fonctionnalité signature : quitter l'analyse du seul diff pour raisonner sur le **dépôt
entier**. Scanner les migrations SQL pour savoir quelles tables sont protégées par une policy
RLS, puis croiser cette carte avec les accès `supabase.from()` introduits par la PR. Une table
lue côté client **sans RLS effective** est une **route orpheline** — n'importe quel utilisateur
(même anonyme) peut lire toutes ses lignes via l'API.

Enjeu central : **gérer l'incertitude**. Le scan est forcément partiel ; l'agent ne doit jamais
affirmer « orpheline » pour une table qu'il ne voit pas.

---

## ✅ Definition of Done

- [x] `src/context/rls.ts` — scan des `.sql` : `CREATE TABLE`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY ... ON`.
- [x] `src/context/collector.ts` — extraction des accès `supabase.from()` du diff + sérialisation du contexte.
- [x] Prompt v2 enrichi de `ORPHAN_TABLE_ACCESS` + contexte RLS injecté après le diff + règles d'incertitude.
- [x] Incertitude : table UNKNOWN (absente du scan) → au mieux `info` en question, jamais `high`.
- [x] `CATEGORIES` élargie (`SERVICE_ROLE_LEAK` + `ORPHAN_TABLE_ACCESS`) — se propage aux 3 encodages (Zod, outil Claude, schéma Gemini).
- [x] Fixtures : `secrets` sans policy → finding ; `documents` avec policy → silence.
- [x] **Test :** détecte l'orpheline, reste silencieux quand la RLS existe.

---

## 🗂️ Livrable — fichiers ajoutés / modifiés

| Fichier | Statut | Rôle |
|---|---|---|
| `src/context/rls.ts` | **nouveau** | Scan des `.sql` → carte `table → { rlsEnabled, policies }` + `statusFor`. |
| `src/context/collector.ts` | **nouveau** | Accès `from()` du diff (lignes ajoutées + n° de ligne) + sérialisation du contexte. |
| `src/analyzer/prompt.ts` | **modifié** | System prompt v2 (2 catégories) + injection du contexte + règles UNKNOWN. |
| `src/analyzer/schema.ts` | **modifié** | `CATEGORIES` élargie à `ORPHAN_TABLE_ACCESS`. |
| `src/analyzer/provider.ts` + `providers/{claude,gemini}.ts` | **modifié** | `analyze(files, securityContext?)` — le contexte est transmis aux deux fournisseurs. |
| `src/index.ts` | **modifié** | Scan RLS (`process.cwd()`) + extraction + sérialisation avant analyse (seulement si la PR a des accès `from()`). |
| `tests/local.ts` | **modifié** | Scan du dépôt d'exemple + auto-tests RLS / orphelines + contexte dans l'analyse réelle. |
| `tests/fixtures/orphan.diff` | **nouveau** | Lecture de `secrets` (sans RLS) côté client → orphelin attendu. |
| `tests/fixtures/protected.diff` | **nouveau** | Lecture de `documents` (RLS + policy) → 0 finding. |
| `tests/fixtures/sample-repo/` | **nouveau** | Dépôt SQL d'exemple (3 tables protégées + `secrets` orpheline). |
| `README.md`, `package.json` | **modifié** | Doc Sprint 3, version `0.5.0`. |

> Note : le plan indiquait `0.4.0`, mais ce numéro était déjà pris (correctif `0.4.1`) →
> le Sprint 3 bumpe en `0.5.0`. Et l'architecture étant multi-fournisseur, le contexte
> passe par l'interface `Analyzer.analyze(files, securityContext)` plutôt que par un seul `claude.ts`.

---

## 🧠 Décisions techniques (et pourquoi)

- **Scan du système de fichiers, pas de l'API GitHub.** En CI, `actions/checkout` (`fetch-depth: 0`,
  posé dès le Sprint 0) met le dépôt à `process.cwd()` ; le scan RLS parcourt ce dépôt local.
- **« Protégée » = RLS activée ET au moins une policy.** RLS sans policy = deny-all (rien n'est
  lisible) : pas une exposition. Le danger, c'est l'absence de RLS sur une table existante.
- **Quatre statuts, dont UNKNOWN — le garde-fou de précision.** protégée / non protégée /
  RLS-sans-policy / UNKNOWN (table absente du scan). UNKNOWN → jamais d'assertion `high` ;
  au plus un `info` en question. C'est ce qui évite le faux positif quand une migration vit ailleurs.
- **Extraction sur les lignes AJOUTÉES uniquement.** Un accès `from()` préexistant n'est pas
  introduit par la PR : on ne le signale pas.
- **Strip des commentaires SQL avant parsing.** Un `-- ENABLE ROW LEVEL SECURITY` commenté ne
  doit pas être compté comme une protection réelle (vérifié par fixture).
- **Le contexte sérialisé sert de vérité terrain.** Le modèle reçoit la carte des tables + leur
  statut + les tables touchées avec leur ligne, et raisonne sur du concret.

---

## ▶️ Lancer & vérifier

```bash
npm install
npm run typecheck    # -> Typecheck OK
npm run test:local   # aperçu + auto-tests (validation, ancrage, RLS, fournisseur)
ANTHROPIC_API_KEY=sk-... npm run test:local   # ou LLM_PROVIDER=gemini GEMINI_API_KEY=...
```

Auto-test RLS (extrait attendu) :
```
=== Auto-test hors-ligne (contexte RLS / routes orphelines) ===
  ✓ scan : 4 tables (users/notes/documents protégées, secrets orpheline)
  ✓ extraction du diff : orphan -> secrets, protected -> documents
  ✓ contexte sérialisé : secrets signalée NOT protected, documents protégée
```

Test réel attendu :

| Fixture | Attendu |
|---|---|
| `orphan.diff` | 1 finding `high` `ORPHAN_TABLE_ACCESS` sur `secrets` |
| `protected.diff` | 0 finding |
| `vulnerable.diff` | 1 finding `critical` `SERVICE_ROLE_LEAK` |
| `clean.diff` | 0 finding |

---

## ⚠️ Limites connues (dette assumée)

- **Commentaire non idempotent** → **Sprint 5** (marqueur caché + dédoublonnage).
- **Parsing SQL heuristique** : couvre `CREATE TABLE` / `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY`
  standards ; les migrations exotiques peuvent échapper au scan — d'où la règle UNKNOWN.
- **Erreur LLM transitoire (503/429)** fait encore échouer l'action (pas de retry/fail-soft) → **Sprint 5**.
- **Over-fetching pas encore détecté** → **Sprint 4**.
- **Gros diffs / gros dépôts** non optimisés → **Sprint 5**.

---

## ➡️ Passage au Sprint 4

Ajouter la dernière catégorie de détection : l'**over-fetching de colonnes sensibles**
(`SENSITIVE_OVERFETCH`). Flaguer uniquement les `select()` qui exposent des colonnes clairement
sensibles (`password_hash`, `*_token`, `secret`, PII forte), proposer un `select` réduit, et
ignorer les `select('*')` anodins. Fixtures positives et négatives.
