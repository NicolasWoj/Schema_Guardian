# Sprint 2 — Commentaires ancrés ligne par ligne

> **Projet :** Schema Guardian — agent de sécurité pour la frontière Next.js ↔ Supabase.
> **Statut :** ✅ Terminé et vérifié (typecheck + auto-tests hors-ligne ; test réel à lancer avec une clé API).

---

## 🎯 Objectif

Transformer le commentaire de synthèse du Sprint 1 en **revue ancrée**, façon relecture
humaine : chaque finding apparaît directement sur la ligne concernée dans la PR. Le tout
sans jamais faire échouer l'action — y compris quand GitHub refuse un ancrage.

---

## 📦 Périmètre

### Dans ce sprint
- Parser de hunks dédié : extraction, par fichier, des **lignes commentables** (RIGHT).
- Publication d'une **revue ancrée** (`pulls.createReview`, `side: "RIGHT"`).
- **Garde-fou anti-422** : findings hors-diff → synthèse, et tout refus d'ancrage → repli.
- Rendu d'un **commentaire en ligne** distinct de la synthèse.
- Auto-test hors-ligne du mapping (partition ancré / non ancré).

### Hors de ce sprint (reporté)
- Routes orphelines sans RLS → **Sprint 3**.
- Over-fetching de colonnes sensibles → **Sprint 4**.
- Idempotence, gros diffs, blocage de PR → **Sprint 5**.

---

## ✅ Definition of Done

- [x] `src/github/diff.ts` — parser de hunks : `commentableLinesInPatch` / `…ByFile` + `partitionByAnchorability`.
- [x] `src/github/review.ts` — `postReview` : `createReview` avec `comments[]` ancrés (`path` + `line` + `side: "RIGHT"`).
- [x] `src/report/formatter.ts` — `formatInlineComment` + `formatReviewSummary` (non-ancrés).
- [x] `src/index.ts` — orchestration ancrage + repli en synthèse.
- [x] **Garde-fou :** validation de la ligne contre le diff **et** `try/catch` autour de la revue (jamais de 422 fatale).
- [x] **Test :** un finding sur une ligne du diff est ancré ; un finding hors diff bascule en synthèse.

---

## 🗂️ Livrable — fichiers ajoutés / modifiés

| Fichier | Statut | Rôle |
|---|---|---|
| `src/github/diff.ts` | **nouveau** | Parser de hunks → lignes commentables (RIGHT) + partition ancré / non-ancré. |
| `src/github/pr.ts` | **modifié** | `PrRef.headSha` (SHA de tête, pour `commit_id`). |
| `src/github/review.ts` | **modifié** | `postReview` (revue ancrée) + interface `InlineComment`. |
| `src/report/formatter.ts` | **modifié** | `formatInlineComment` + `formatReviewSummary` (non-ancrés). |
| `src/index.ts` | **modifié** | Orchestration : ancrage ligne par ligne, repli automatique. |
| `tests/local.ts` | **modifié** | Auto-test d'ancrage + analyse réelle affichant `file:line`. |
| `tests/fixtures/*.diff` | **modifié** | En-têtes de hunk corrigés (`+1,16` et `+1,14`) pour un mapping fiable. |
| `README.md`, `package.json` | **modifié** | Doc Sprint 2, version `0.4.0`. |

> Note de mise en œuvre : le plan listait un retrait de `parse-diff`, mais ce projet n'a
> jamais utilisé cette lib (parser maison depuis le Sprint 0). Et `0.3.0` étant déjà pris par
> le commit de l'interface multi-fournisseur, le Sprint 2 bumpe en `0.4.0`.

---

## 🧠 Décisions techniques (et pourquoi)

- **Parser de hunks maison.** Il lit `+start` dans l'en-tête `@@ ... +start @@` puis incrémente
  lui-même, sans faire confiance au `count` déclaré — robuste aux diffs mal formés.
- **Seules les lignes côté RIGHT sont commentables.** GitHub n'accepte un commentaire que sur
  une ligne présente dans le diff : lignes ajoutées (`+`) et de contexte (espace). Les lignes
  supprimées (`-`) sont côté LEFT et ne consomment pas de numéro RIGHT.
- **Garde-fou anti-422 en deux couches.** (1) On ne transmet à `createReview` que des lignes
  garanties présentes ; (2) l'appel est entouré d'un `try/catch` qui replie tout sur un
  commentaire d'issue en cas de refus. L'action ne tombe jamais sur l'ancrage.
- **Évènement `COMMENT` (non bloquant).** Principe « fail open » du plan ; le blocage opt-in
  viendra au Sprint 5.
- **`commit_id` = SHA de tête de la PR** (`PrRef.headSha`, lu dans le payload). L'ancrage est
  rattaché au bon commit.

---

## ▶️ Lancer & vérifier

```bash
npm install
npm run typecheck    # -> Typecheck OK
npm run test:local   # aperçu + auto-tests (validation + ancrage)
ANTHROPIC_API_KEY=sk-... npm run test:local   # ou LLM_PROVIDER=gemini GEMINI_API_KEY=...
```

Auto-test d'ancrage (extrait attendu) :
```
=== Auto-test hors-ligne (ancrage ligne par ligne) ===
  ✓ lignes commentables de UserList.tsx : 16 (dont la 8)
  ✓ partition : ligne 8 ancrée, ligne 99 en synthèse
  ✓ rendu : commentaire en ligne + synthèse des non-ancrés
```

Test réel attendu : le finding tombe sur **`app/dashboard/UserList.tsx:8`** (ligne du `service_role`).

---

## ⚠️ Limites connues (dette assumée)

- **Commentaire non idempotent** : une nouvelle revue à chaque push → **Sprint 5**.
- **Une seule catégorie active** → **Sprints 3 et 4**.
- **Gros diffs non gérés** (pas de chunking ni plafond) → **Sprint 5**.

---

## ➡️ Passage au Sprint 3

Introduire le **contexte de sécurité du repo** pour détecter les **routes orphelines**
(table requêtée côté client sans policy RLS) :
1. `context/rls.ts` — scanner `.sql`/migrations → carte `table → { rls_enabled, policies[] }`.
2. `context/collector.ts` — extraire les accès `supabase.from('X')…` du diff, croiser avec la carte.
3. Enrichir le prompt avec `ORPHAN_TABLE_ACCESS` + le contexte RLS sérialisé.
4. Incertitude : carte RLS incomplète → rétrograder en `info` et formuler une *question*.
