# Sprint 4 — Over-fetching de colonnes sensibles

> **Projet :** Schema Guardian — agent de sécurité pour la frontière Next.js ↔ Supabase.
> **Statut :** ✅ Terminé et vérifié (typecheck + auto-tests hors-ligne ; test réel à lancer avec une clé API).

---

## 🎯 Objectif

Ajouter le **troisième et dernier détecteur** : l'over-fetching de colonnes sensibles. Un `select()`
qui tire `password_hash`, un token ou une PII forte expose ces données dans la réponse réseau —
**même quand la RLS protège les lignes**. L'over-fetch est donc indépendant des deux premières classes.

L'enjeu est presque entièrement l'**anti-bruit** : ne jamais signaler un `select('*')` anodin ni des
colonnes courantes (`id`, `email`, `title`), sous peine de noyer les vrais problèmes. Les trois
catégories de l'agent sont désormais complètes.

---

## ✅ Definition of Done

- [x] Catégorie `SENSITIVE_OVERFETCH` (`medium`) ajoutée au schéma (via `CATEGORIES`) et au prompt v3.
- [x] `extractSensitiveSelects` — repère les colonnes sensibles dans les `select()` ajoutés (table + ligne).
- [x] **Anti-bruit :** `select('*')` ne matche aucun motif ; `email` et noms génériques exclus (liste étroite).
- [x] Le contexte sérialisé liste les colonnes sensibles repérées (grounding du modèle).
- [x] Fixture `overfetch.diff` (`password_hash` sur table protégée) + `clean.diff` silencieuse.
- [x] **Test :** `select('id, email, password_hash')` → over-fetch ; `select('id, title')` / `select('*')` → silence.

---

## 🗂️ Livrable — fichiers ajoutés / modifiés

| Fichier | Statut | Rôle |
|---|---|---|
| `src/context/collector.ts` | **modifié** | `extractSensitiveSelects` + `isSensitiveColumn` ; `serializeSecurityContext` liste les colonnes sensibles. |
| `src/analyzer/prompt.ts` | **modifié** | System prompt v3 (3 catégories) + section `SENSITIVE_OVERFETCH` et son anti-bruit. |
| `src/analyzer/schema.ts` | **modifié** | `CATEGORIES` élargie à `SENSITIVE_OVERFETCH` (se propage aux 3 encodages). |
| `src/index.ts` | **modifié** | Extraction des colonnes sensibles + contexte enrichi avant analyse. |
| `tests/local.ts` | **modifié** | Fixture `overfetch` dans la boucle + auto-test d'over-fetch. |
| `tests/fixtures/overfetch.diff` | **nouveau** | `select('id, email, password_hash')` sur `users` (protégée, clé anon). |
| `tests/fixtures/orphan.diff` | **modifié** | `select('id, value')` (colonne générique) — renforce l'anti-bruit over-fetch. |
| `README.md`, `package.json` | **modifié** | Doc Sprint 4, version `0.6.0`. |

> Pas de nouveau module : extension de `collector.ts`. La détection repose sur le pré-scan
> (grounding) + le prompt. Le plan indiquait `0.5.0` (déjà pris par le Sprint 3) → `0.6.0`.

---

## 🧠 Décisions techniques (et pourquoi)

- **Liste de colonnes sensibles volontairement étroite.** Uniquement des noms sans ambiguïté
  (`password*`, `secret`, `token`, `api_key`, `private_key`, `ssn`, `credit_card`, `cvv`…). `email`
  et les noms génériques (`value`, `body`, `data`, `id`, `title`) sont **exclus** — levier de précision.
- **`select('*')` n'est jamais signalé par le pré-scan.** Une étoile ne matche aucun motif → zéro bruit
  automatique. Le modèle garde la latitude de juger un `*` sur une table notoirement sensible.
- **Le pré-scan sert de grounding.** On fournit au modèle la liste des colonnes sensibles repérées
  (table + ligne) plutôt que de le laisser deviner ; une partie de la détection devient testable hors-ligne.
- **L'over-fetch est indépendant de la RLS et du service_role.** D'où la fixture qui cible une table
  **protégée** avec la clé **anon** : seul l'over-fetch doit se déclencher.

---

## ▶️ Lancer & vérifier

```bash
npm install
npm run typecheck    # -> Typecheck OK
npm run test:local   # validation, ancrage, RLS, over-fetch, fournisseur
ANTHROPIC_API_KEY=sk-... npm run test:local   # ou LLM_PROVIDER=gemini GEMINI_API_KEY=...
```

Auto-test over-fetch (extrait attendu) :
```
=== Auto-test hors-ligne (over-fetch de colonnes sensibles) ===
  ✓ détection : password_hash repéré (table users)
  ✓ anti-bruit : select('id, title') -> rien
  ✓ schéma : catégorie SENSITIVE_OVERFETCH acceptée
```

Test réel attendu :

| Fixture | Attendu |
|---|---|
| `vulnerable.diff` | `critical` service_role |
| `clean.diff` | 0 finding |
| `orphan.diff` | `high` orphelin sur `secrets` |
| `protected.diff` | 0 finding |
| `overfetch.diff` | `medium` over-fetch sur `password_hash` |

---

## ⚠️ Limites connues (dette assumée → Sprint 5)

- **Commentaire non idempotent** (traîne depuis le Sprint 1) → marqueur caché + dédoublonnage.
- **Pré-scan par liste de motifs** : une colonne sensible au nom inhabituel peut échapper au pré-scan ;
  le prompt reste un second filet, mais la précision prime sur le rappel (choix assumé).
- **Erreur LLM transitoire (503/429)** fait encore échouer l'action (pas de retry/fail-soft).
- **Gros diffs / gros dépôts** non optimisés ; **pas de calibrage formel** des faux positifs.

---

## ➡️ Passage au Sprint 5 (le dernier)

Durcissement pour rendre l'agent adoptable en équipe : idempotence des commentaires (marqueur caché +
dédoublonnage), jeu d'éval ≥ 10 fixtures avec mesure de précision, gestion des gros diffs (chunking +
plafonds), config `.guardianrc` (ignore, allowlist, seuils), blocage opt-in par sévérité. À envisager
aussi : le fail-soft / retry sur erreur LLM transitoire.
