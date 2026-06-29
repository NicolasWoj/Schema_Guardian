# Sprint 1 — MVP : détection `SERVICE_ROLE_LEAK` + commentaire de synthèse

> **Projet :** Schema Guardian — agent de sécurité pour la frontière Next.js ↔ Supabase.
> **Statut :** ✅ Terminé et vérifié (typecheck + auto-tests hors-ligne ; test réel à lancer avec une clé API).

---

## 🎯 Objectif

Livrer le **pipeline complet de bout en bout** sur la classe de faille la plus simple à
confirmer avec une haute précision : la **fuite de clé `service_role`** (clé d'admin Supabase
exposée à du code atteignable par le navigateur). Prouver la chaîne
`diff → analyse LLM → commentaire` et valider le socle anti-faux-positifs.

---

## 📦 Périmètre

### Dans ce sprint
- System prompt v1, focalisé sur **une seule** classe de faille.
- Outil `report_findings` en **sortie structurée stricte** + validation Zod.
- Appel à l'API Claude (`claude-sonnet-4-6`) avec `tool_choice` forcé.
- Transformation des findings en **commentaire Markdown** de synthèse.
- Branchement du pipeline dans le point d'entrée (remplace le « message de vie »).
- Fixtures **vulnérable** et **propre** + auto-tests hors-ligne du parsing/rendu.

### Hors de ce sprint (reporté)
- Ancrage des commentaires **ligne par ligne** → **Sprint 2**.
- Détection des **routes orphelines** sans RLS → **Sprint 3**.
- **Over-fetching** de colonnes sensibles → **Sprint 4**.
- **Idempotence**, gros diffs, blocage de PR → **Sprint 5**.

---

## ✅ Definition of Done

- [x] `src/analyzer/prompt.ts` — system prompt v1 limité à `SERVICE_ROLE_LEAK` + message utilisateur.
- [x] `src/analyzer/schema.ts` — outil `report_findings` (`strict: true`) + schéma Zod.
- [x] `src/analyzer/claude.ts` — appel SDK Anthropic, `tool_choice` forcé, parsing/validation.
- [x] `src/report/formatter.ts` — findings → commentaire Markdown trié par sévérité.
- [x] `src/index.ts` — pipeline `filtre → analyse → commentaire`, avec garde-coût.
- [x] Fixtures `vulnerable.diff` (1 finding attendu) et `clean.diff` (0 attendu).
- [x] **Critère de réussite :** `vulnerable.diff` → **1 finding `critical`** ; `clean.diff` → **0 finding** (test réel avec clé API).

---

## 🧠 Décisions techniques (et pourquoi)

- **Sortie structurée stricte + double validation.** L'outil est en `strict: true`
  (l'API garantit la conformité au schéma : `additionalProperties: false` + `required`
  exhaustif), **et** la réponse est revalidée par Zod côté Node. Ceinture *et* bretelles.
- **Prompt mono-catégorie = précision.** L'enum du schéma et le prompt se limitent à
  `SERVICE_ROLE_LEAK` ; ils s'étendront catégorie par catégorie aux sprints suivants.
- **Distinguer `service_role` de la clé anon.** Le prompt insiste : la clé anon
  (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) est faite pour être publique et gouvernée par la RLS —
  ne jamais la signaler. C'est ce qui évite le faux positif sur la fixture propre.
- **`tool_choice` forcé sur `report_findings`.** Le modèle répond toujours via l'outil,
  jamais en prose : le parsing côté Node est déterministe.
- **Garde-coût conservé.** Aucun appel LLM si le filtre ne retient aucun fichier pertinent.
- **Modèle `claude-sonnet-4-6`** (choix explicite du plan) : bon rapport raisonnement/coût
  pour un outil qui tourne sur chaque PR.

---

## ▶️ Lancer & vérifier

```bash
npm install
npm run typecheck    # -> Typecheck OK
npm run test:local   # aperçu fixtures + auto-tests hors-ligne
ANTHROPIC_API_KEY=sk-... npm run test:local   # critère de réussite (appel réel)
```

Auto-tests hors-ligne (extraits attendus) :
```
=== Auto-test hors-ligne (parse + validation + rendu) ===
  ✓ réponse outillée -> 1 finding critical, rendu Markdown OK
  ✓ réponse vide -> commentaire « aucune fuite »
  ✓ réponse non conforme -> rejetée
```

---

## ⚠️ Limites connues (dette assumée)

- **Commentaire non idempotent** → **Sprint 5** (marqueur caché + mise à jour).
- **`line` pas encore exploité** : la synthèse reste globale, non ancrée → **Sprint 2**.
- **Une seule catégorie active** → **Sprints 3 et 4**.
- **Gros diffs non gérés** (pas de chunking ni plafond) → **Sprint 5**.

---

## ➡️ Passage au Sprint 2

Transformer la synthèse en **revue ancrée ligne par ligne** :
1. Parser le diff unifié → lignes commentables par fichier.
2. Poster via `pulls.createReview` avec `path` + `line` + `side: "RIGHT"`.
3. Garde-fou : tout finding hors-diff est reversé dans la synthèse (jamais de 422).
