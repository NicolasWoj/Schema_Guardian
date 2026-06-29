# Schema Guardian — Plan de travail, MVP & Sprints

> Agent de Sécurité & Architecture pour la frontière **Next.js ↔ Supabase**.
> Document conçu pour piloter **Claude Code** sprint par sprint.

---

## Partie 0 — Vision & principe directeur produit

Dans une stack Next.js + Supabase, l'autorisation ne vit plus dans un gros backend : elle vit dans les **policies RLS** de PostgreSQL. Le risque structurel, c'est l'écart entre ce que le front *demande* et ce que la base *autorise*. Schema Guardian audite précisément cet écart.

**La contrainte produit n°1 — à graver dans le marbre : précision > rappel.**
Un bot de sécurité bruyant est désinstallé en une semaine. Un faux positif coûte plus cher qu'un vrai positif manqué, parce qu'il détruit la confiance et entraîne le réflexe « de toute façon il dit n'importe quoi ». Toute décision de design tranche en faveur de la **haute confiance** : en cas de doute, l'agent se tait ou rétrograde la sévérité en `info`.

**Deux décisions d'architecture qui en découlent :**
- **Fail open par défaut.** Le MVP *commente*, il ne *bloque pas*. Le blocage de PR (status check) devient opt-in, par niveau de sévérité, une fois le taux de faux positifs maîtrisé (Sprint 5).
- **Filtrage en amont.** On n'invoque le LLM que si la PR touche des fichiers pertinents (`*.ts/*.tsx` contenant `supabase`, `*.sql`, migrations, env/config). Sinon, l'action sort en succès silencieux. C'est aussi le premier levier de coût.

---

## Partie 1 — Architecture cible

### Le flux

```
PR ouverte / mise à jour (push)
        │
        ▼
GitHub Action  ──►  COLLECTOR  ──►  ANALYZER (Claude)  ──►  REPORTER  ──►  Review postée sur la PR
                    (contexte)      (findings JSON)        (commentaires)
```

### L'insight central : le diff seul ne suffit pas

Pour détecter une **route orpheline** (table requêtée sans RLS), regarder le diff ne suffit pas : la policy RLS peut exister ailleurs dans le repo, ou manquer partout. L'agent a donc besoin de **deux niveaux de contexte** :

1. **Le diff** — ce qui change dans cette PR (les nouvelles requêtes, les nouveaux composants).
2. **L'état de sécurité du repo** — ce qui existe déjà : carte des tables, policies RLS connues, endroits où la `service_role` est utilisée.

C'est cette consolidation qui distingue un agent crédible d'un simple « envoie le diff au LLM ».

### Les 4 composants

| Composant | Rôle | Modules |
|---|---|---|
| **GitHub Action** | Orchestrateur, déclenché sur `pull_request` | `security-agent.yml` |
| **Collector** | Assemble le contexte (diff + état RLS du repo), filtre les fichiers pertinents | `context/` |
| **Analyzer** | Envoie le contexte à Claude, récupère des findings en JSON garanti | `analyzer/` |
| **Reporter** | Mappe les findings sur des lignes de la PR, poste la review, gère l'idempotence | `report/`, `github/review.ts` |

---

## Partie 2 — Le MVP

L'objectif du MVP est de prouver le **pipeline de bout en bout** sur la catégorie la plus simple et à plus fort signal, pas de tout détecter d'un coup.

### Dans le MVP
- Déclenchement sur PR via GitHub Action.
- Récupération du diff via Octokit.
- Filtrage : on ne lance l'analyse que si des fichiers `.ts/.tsx` pertinents sont touchés.
- Appel à Claude avec un system prompt strict, **focalisé sur une seule catégorie : `SERVICE_ROLE_LEAK`** (clé d'admin exposée côté client). C'est le cas le plus facile à confirmer avec haute précision : c'est un usage détectable, pas une inférence de logique.
- Sortie structurée (Structured Outputs / strict tool use) → liste de findings JSON.
- Restitution : **un seul commentaire de synthèse** sur la PR (pas encore d'ancrage ligne par ligne).

### Hors MVP (sprints suivants)
- Commentaires ancrés ligne par ligne.
- Détection RLS / route orpheline (nécessite le contexte repo).
- Over-fetching de colonnes sensibles.
- Blocage de PR, config, dédoublonnage avancé.

### Critère de succès / démo
Sur une PR de test qui importe `SUPABASE_SERVICE_ROLE_KEY` dans un composant `"use client"`, l'agent poste automatiquement un commentaire `critical` qui (a) nomme le fichier, (b) explique l'attaque, (c) propose le correctif. Sur une PR propre, il ne dit rien. **Zéro faux positif sur le jeu de fixtures.**

---

## Partie 3 — Roadmap par sprints (à donner à Claude Code)

> Méthode : **un sprint = une session Claude Code**. On lui fournit ce document + le sprint ciblé. Chaque sprint a une *Definition of Done* (DoD) testable.

### Sprint 0 — Fondations & échafaudage

**Objectif :** un squelette qui s'exécute en CI et poste « hello » sur une PR. On valide la plomberie avant la logique.

**Tâches (DoD) :**
- [ ] Projet TypeScript : `package.json`, `tsconfig.json`, build (`tsc` ou `tsx`).
- [ ] Arborescence (voir Partie 7).
- [ ] `security-agent.yml` déclenché sur `pull_request` (`opened`, `synchronize`, `reopened`).
- [ ] Permissions du workflow : `contents: read`, `pull-requests: write`.
- [ ] Secret `ANTHROPIC_API_KEY` documenté ; `GITHUB_TOKEN` câblé.
- [ ] Octokit initialisé avec `GITHUB_TOKEN` ; lecture du numéro de PR depuis l'`event payload`.
- [ ] Harnais de test local : un script qui rejoue un diff de fixture **sans** GitHub (pour itérer hors CI).
- [ ] **Test :** sur une PR de test, l'action poste un commentaire « Schema Guardian actif ✅ ».

**Livrable :** repo qui tourne en CI, commente une PR, testable en local.

**Prompt pour Claude Code :**
> « Initialise un projet GitHub Action en TypeScript nommé `schema-guardian`. Crée l'arborescence de la Partie 7 du plan, le workflow `security-agent.yml` (déclenché sur pull_request, permissions pull-requests: write), l'init Octokit avec GITHUB_TOKEN, et un harnais de test local qui rejoue un diff de fixture sans appeler GitHub. À la fin, l'action doit poster un commentaire de test sur la PR. Ne code pas encore l'analyse LLM. »

---

### Sprint 1 — MVP : détection mono-catégorie + commentaire de synthèse

**Objectif :** le pipeline complet pour `SERVICE_ROLE_LEAK`.

**Tâches (DoD) :**
- [ ] `github/pr.ts` : récupérer le diff (`pulls.get` avec `mediaType: diff`, ou `listFiles` avec `patch`).
- [ ] `context/filter.ts` : ne garder que les fichiers `.ts/.tsx` candidats (présence de `supabase`, `service_role`, création de client). Si rien → sortie silencieuse.
- [ ] `analyzer/prompt.ts` : system prompt v1 (Partie 4), limité à `SERVICE_ROLE_LEAK`.
- [ ] `analyzer/schema.ts` : schéma de l'outil `report_findings` (Partie 4).
- [ ] `analyzer/claude.ts` : appel SDK Anthropic avec **strict tool use** (`strict: true`) ou JSON outputs ; modèle `claude-sonnet-4-6`.
- [ ] `report/formatter.ts` : transformer les findings en un commentaire Markdown lisible (titre, sévérité, fichier, explication, correctif).
- [ ] `github/review.ts` : poster **un** commentaire de synthèse (`issues.createComment` sur la PR).
- [ ] Jeu de fixtures : 1 PR « vulnérable » + 1 PR « propre ».
- [ ] **Test :** PR vulnérable → 1 finding `critical` exact ; PR propre → 0 finding.

**Livrable :** MVP démontrable de bout en bout.

**Prompt pour Claude Code :**
> « Implémente le MVP du plan (Partie 2). Récupère le diff via Octokit, filtre les fichiers pertinents, envoie le code modifié à Claude (modèle claude-sonnet-4-6) avec le system prompt v1 limité à SERVICE_ROLE_LEAK et l'outil report_findings en strict tool use, puis poste un commentaire de synthèse sur la PR. Ajoute deux fixtures (PR vulnérable, PR propre) et vérifie zéro faux positif sur la PR propre. »

---

### Sprint 2 — Ancrage ligne par ligne

**Objectif :** des commentaires sur la ligne exacte, façon revue humaine.

**Tâches (DoD) :**
- [ ] Parser le diff unifié → pour chaque fichier, l'ensemble des **lignes commentables** (lignes ajoutées/contextuelles présentes dans le diff).
- [ ] `github/review.ts` : `pulls.createReview` avec un tableau `comments`, chaque commentaire ancré par `path` + `line` + `side: "RIGHT"` (voir Pièges, Partie 6).
- [ ] **Garde-fou robustesse :** valider la `line` de chaque finding contre l'ensemble des lignes commentables. Si non commentable → repli dans le commentaire de synthèse (jamais d'erreur 422 qui fait échouer l'action).
- [ ] **Test :** les findings tombent sur la bonne ligne ; un finding hors-diff bascule proprement en synthèse.

**Livrable :** revue ancrée ligne par ligne, sans crash sur les cas limites.

**Prompt pour Claude Code :**
> « Ajoute l'ancrage ligne par ligne. Parse le diff pour extraire les lignes commentables par fichier, poste les findings via pulls.createReview avec path+line+side=RIGHT. Implémente un garde-fou : tout finding dont la ligne n'est pas dans le diff est reversé dans le commentaire de synthèse au lieu de lever une 422. »

---

### Sprint 3 — Détection RLS / « Route Orpheline »

**Objectif :** la fonctionnalité signature. Nécessite le contexte repo.

**Tâches (DoD) :**
- [ ] `context/rls.ts` : scanner les `*.sql` et migrations du repo → carte `table → { rls_enabled, policies[] }`. Détecter `ENABLE ROW LEVEL SECURITY` et `CREATE POLICY`.
- [ ] `context/collector.ts` : extraire du diff les accès clients `supabase.from('X').select/insert/update/delete` et les associer à la carte RLS.
- [ ] Enrichir le system prompt avec la catégorie `ORPHAN_TABLE_ACCESS` **et** le contexte RLS sérialisé (liste des tables et leur statut RLS).
- [ ] **Gestion de l'incertitude :** si le contexte RLS est partiel (toutes les migrations ne sont pas dans la PR), le prompt impose de rétrograder en `info` et de formuler une *question*, pas une assertion.
- [ ] Fixtures : table requêtée côté client sans policy → `high` ; même table avec policy → silence.
- [ ] **Test :** détecte l'orpheline, ne crie pas quand la RLS existe.

**Livrable :** détection de routes orphelines avec gestion explicite de l'incertitude.

**Prompt pour Claude Code :**
> « Implémente la détection ORPHAN_TABLE_ACCESS (Partie 5). Construis une carte table→RLS en scannant les fichiers .sql/migrations du repo, croise-la avec les accès supabase.from() trouvés dans le diff, et passe ce contexte à Claude. Quand la carte RLS est incomplète, le prompt doit rétrograder en info et formuler une question. Ajoute des fixtures pour les deux cas. »

---

### Sprint 4 — Over-fetching de colonnes sensibles

**Objectif :** repérer l'exposition de colonnes critiques.

**Tâches (DoD) :**
- [ ] Catégorie `SENSITIVE_OVERFETCH` : détecter les `select` qui tirent des colonnes manifestement sensibles (`password_hash`, `*_token`, `secret`, PII forte) sans usage apparent.
- [ ] Heuristique anti-bruit : `select('*')` n'est pas automatiquement un finding ; ne flaguer que sur colonnes nommées clairement sensibles, ou `*` sur une table connue pour contenir des secrets.
- [ ] Le finding doit nommer **les colonnes** à risque et proposer un `select` réduit.
- [ ] **Test :** `select('id, email, password_hash')` → `medium` ciblé sur `password_hash` ; `select('id, title')` → silence.

**Livrable :** détection d'over-fetching ciblée, faible bruit.

**Prompt pour Claude Code :**
> « Ajoute la catégorie SENSITIVE_OVERFETCH (Partie 5). Flague uniquement les select() qui exposent des colonnes clairement sensibles, propose un select réduit, et ignore les select('*') anodins. Ajoute des fixtures positives et négatives. »

---

### Sprint 5 — Durcissement, calibrage & DX

**Objectif :** rendre l'agent adoptable en équipe réelle.

**Tâches (DoD) :**
- [ ] **Calibrage faux positifs :** jeu d'éval (≥ 10 fixtures), mesurer précision, ajuster le prompt. Objectif : 0 faux positif sur le jeu.
- [ ] **Idempotence :** marquer les commentaires du bot (marqueur HTML caché) et dédoublonner / mettre à jour entre deux pushes au lieu d'empiler.
- [ ] **Diffs volumineux :** chunking par fichier + plafond ; au-delà, n'analyser que les fichiers pertinents et signaler la troncature.
- [ ] **Coût :** journaliser les tokens ; n'appeler le LLM que sur fichiers pertinents (déjà en place, à vérifier).
- [ ] **Config `.guardianrc` :** chemins à ignorer, allowlist (ex. fichiers serveur de confiance), seuils de sévérité.
- [ ] **Blocage opt-in :** status check qui échoue uniquement à partir d'un niveau configuré (ex. `critical` seulement).
- [ ] **README** : installation, secret à créer, capture d'écran d'un commentaire.

**Livrable :** outil robuste, calibré, documenté, prêt à être branché sur un vrai repo.

**Prompt pour Claude Code :**
> « Durcis l'agent (Partie 3, Sprint 5) : jeu d'éval de fixtures avec mesure de précision, idempotence des commentaires via marqueur caché, gestion des diffs volumineux par chunking, fichier de config .guardianrc (ignore, allowlist, seuils), status check de blocage opt-in par sévérité, et README complet. »

---

## Partie 4 — Prompt engineering : le cerveau de l'agent

C'est le cœur du projet. La qualité de l'agent = qualité du system prompt + fiabilité de la sortie structurée.

### Principes de conception

1. **Rôle étroit et explicite.** « Auditeur sécurité de la frontière front↔DB », *pas* « relecteur de code ». On lui interdit explicitement le style, le naming, la perf.
2. **Calibrage de la confiance dans le prompt lui-même.** On lui dit qu'il est jugé sur la **précision**, qu'un faux positif est pire qu'un oubli, et qu'en cas de doute il se tait.
3. **Critère « attaque concrète ».** Un finding n'est valide que s'il peut nommer fichier + ligne + une phrase d'attaque (« un utilisateur anonyme pourrait… »). Sinon, il l'omet.
4. **Sortie 100 % structurée.** Pas de prose : tout passe par l'outil `report_findings`, en **strict tool use** (la sortie est garantie conforme au schéma, plus de regex fragile).
5. **Few-shot ciblé.** 1 exemple positif + 1 exemple négatif par catégorie (le négatif est aussi important que le positif pour réduire le bruit).

### System prompt v1 (à étendre catégorie par catégorie)

> Note : prompt rédigé en anglais — il cohabite avec du code et des termes anglais et reste légèrement plus stable ainsi. Adapte selon ta préférence.

```
You are Schema Guardian, a senior application-security engineer reviewing a GitHub pull request. You specialize in the security boundary between front-end code (Next.js / React / TypeScript) and PostgreSQL accessed via Supabase.

Your single job: find concrete, exploitable flaws in the LOGIC between front-end data access and database authorization. You are NOT a linter, a style reviewer, or a general code reviewer. Ignore formatting, naming, performance, and anything unrelated to data-access security.

# What you look for (priority order)

1. ORPHAN_TABLE_ACCESS — A client-reachable query reads/writes a table (e.g. supabase.from('documents').select(...)) for which no Row Level Security policy is enabled or defined in the provided database context. Without RLS, any authenticated or anonymous user can access every row. Highest impact.

2. SERVICE_ROLE_LEAK — The Supabase service role key (SUPABASE_SERVICE_ROLE_KEY, "service_role", or a client built from it) is imported or used in code that can reach the browser: a Client Component ("use client"), a shared client util, or an unauthenticated route/edge handler. The service role bypasses ALL RLS, so any exposure is critical.

3. SENSITIVE_OVERFETCH — A query selects clearly sensitive columns (password hashes, tokens, secrets, strong PII) without apparent need. Flag the over-broad select and name the risky columns.

# Confidence and noise control (read carefully)

- You are judged on PRECISION, not recall. A false positive is worse than a missed issue. When in doubt, DO NOT report.
- Only report a finding when you can name the exact file, the exact risky line, and a concrete attack ("an anonymous user could ..."). Otherwise, omit it.
- select('*') is NOT automatically a flaw. Server-only code (no "use client", protected route, server action) that already enforces auth is usually fine.
- The database context may be incomplete (not every migration is in the diff). If RLS MIGHT exist outside what you see, lower the severity to "info" and phrase the finding as a question, not an assertion.

# Severity scale
- critical: direct unauthenticated exposure or full RLS bypass.
- high: authenticated-but-unauthorized access (orphan table reachable by any logged-in user).
- medium: over-fetch of sensitive columns with limited exposure.
- info: a plausible issue you cannot confirm from the provided context.

# Output
Return findings ONLY through the report_findings tool. Do not write prose. If you are not confident about anything, return an empty findings array.
```

### Schéma de sortie structurée (outil `report_findings`)

Avec `strict: true`, Claude est contraint de produire un JSON conforme à ce schéma — c'est ce qui rend le parsing côté Node totalement fiable.

```json
{
  "name": "report_findings",
  "description": "Report all confirmed security findings for this pull request.",
  "input_schema": {
    "type": "object",
    "properties": {
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "category": { "type": "string", "enum": ["ORPHAN_TABLE_ACCESS", "SERVICE_ROLE_LEAK", "SENSITIVE_OVERFETCH"] },
            "severity": { "type": "string", "enum": ["critical", "high", "medium", "info"] },
            "file":     { "type": "string", "description": "Repo-relative path, exactly as it appears in the diff." },
            "line":     { "type": "integer", "description": "1-based line in the NEW version of the file (RIGHT side of the diff)." },
            "title":    { "type": "string", "description": "One-line summary." },
            "explanation":   { "type": "string", "description": "Why it is exploitable. Name the concrete attack." },
            "suggested_fix": { "type": "string", "description": "Concrete remediation; may include a code or SQL snippet." }
          },
          "required": ["category", "severity", "file", "line", "title", "explanation", "suggested_fix"]
        }
      }
    },
    "required": ["findings"]
  }
}
```

Côté TypeScript, on peut décrire ce schéma en **Zod** puis le convertir en JSON Schema, pour récupérer un objet **typé** après validation. Référence officielle : `https://docs.claude.com/en/docs/build-with-claude/structured-outputs`.

---

## Partie 5 — Les 3 scénarios : comment les détecter réellement

| Scénario | Signal déclencheur | Contexte requis | Méthode | Sévérité type |
|---|---|---|---|---|
| **Route orpheline** | `supabase.from('X').select/insert/...` dans du code client | Carte RLS du repo (Sprint 3) | Croiser la table requêtée avec les policies connues ; absente → finding | `high` (ou `info` si contexte partiel) |
| **Fuite service_role** | Import/usage de `SUPABASE_SERVICE_ROLE_KEY` / client `service_role` | Le fichier lui-même (`"use client"`, route non protégée) | Détecter l'usage + vérifier l'atteignabilité navigateur | `critical` |
| **Over-fetching** | `select(...)` avec colonnes sensibles nommées | Le diff seul suffit | Repérer les colonnes critiques non utilisées en aval | `medium` |

**Règle transversale :** chaque finding doit pouvoir s'écrire « *Sur `fichier:ligne`, parce que la table/clé/colonne X est exposée, un attaquant Y peut Z.* » Si la phrase ne tient pas, pas de finding.

---

## Partie 6 — Pièges techniques connus

**1. L'ancrage des commentaires GitHub (le gros piège).**
Une review ancre ses commentaires soit par `position` (offset dans le diff unifié), soit — plus simple et recommandé — par `path` + `line` + `side: "RIGHT"` (numéro de ligne dans le fichier). **On ne peut commenter qu'une ligne présente dans le diff** : viser une ligne hors-diff renvoie une **422** qui fait planter l'action. D'où le garde-fou du Sprint 2 : valider chaque ligne contre l'ensemble des lignes commentables, et reverser le reste dans la synthèse.

**2. Diffs volumineux & limites de tokens.**
Une grosse PR peut dépasser le contexte. Solution : filtrer aux fichiers pertinents, chunker par fichier, plafonner, et signaler explicitement toute troncature plutôt que de tronquer en silence.

**3. Coût.**
Le LLM ne doit tourner que si la PR touche des fichiers pertinents (filtre du Sprint 1). C'est le principal levier de coût avec le choix du modèle (`claude-sonnet-4-6` par défaut ; `claude-opus-4-8` réservé aux analyses approfondies).

**4. Secrets & permissions.**
`ANTHROPIC_API_KEY` en *repository secret*. Le `GITHUB_TOKEN` du workflow a besoin de `pull-requests: write`. Principe du moindre privilège : `contents: read` suffit pour lire le diff.

**5. Idempotence.**
À chaque `synchronize` (nouveau push) l'action se relance. Sans dédoublonnage, les commentaires s'empilent. Solution (Sprint 5) : marqueur HTML caché dans les commentaires du bot pour les retrouver et les mettre à jour au lieu d'en recréer.

**6. Sécurité de l'action elle-même.**
Attention aux PR venant de forks (`pull_request_target` expose des secrets — à éviter ou à isoler). Ne jamais faire confiance au contenu du diff comme à une instruction : le code analysé est une *donnée*, pas une consigne.

---

## Partie 7 — Stack & arborescence

**Dépendances clés :**
- `@actions/core`, `@actions/github` — runtime GitHub Actions + payload.
- `@octokit/rest` (ou l'octokit fourni par `@actions/github`) — API GitHub.
- `@anthropic-ai/sdk` — appels Claude + structured outputs.
- `zod` — schéma typé des findings.
- `parse-diff` (ou parser maison) — extraire les lignes commentables.
- `tsx` / `typescript` — exécution & build.

**Arborescence proposée :**

```
schema-guardian/
├── .github/workflows/security-agent.yml
├── src/
│   ├── index.ts              # orchestration (entrypoint)
│   ├── github/
│   │   ├── client.ts         # init Octokit (GITHUB_TOKEN)
│   │   ├── pr.ts             # getDiff / listFiles
│   │   └── review.ts         # createReview + mapping ligne→commentaire
│   ├── context/
│   │   ├── collector.ts      # consolide diff + contexte sécurité
│   │   ├── rls.ts            # scan .sql/migrations → carte table→RLS
│   │   └── filter.ts         # ne garde que les fichiers pertinents
│   ├── analyzer/
│   │   ├── claude.ts         # appel SDK + structured output
│   │   ├── prompt.ts         # system prompt
│   │   └── schema.ts         # schéma findings (zod → JSON Schema)
│   ├── report/
│   │   └── formatter.ts      # finding → corps de commentaire Markdown
│   └── types.ts
├── tests/fixtures/           # PRs d'exemple + findings attendus (jeu d'éval)
├── package.json
├── tsconfig.json
└── README.md
```

**Squelette `security-agent.yml` (Sprint 0) :**

```yaml
name: Schema Guardian
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # nécessaire pour scanner les migrations du repo
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx tsx src/index.ts
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Partie 8 — Mode d'emploi avec Claude Code

1. **Un sprint par session.** Ouvre Claude Code, donne-lui ce fichier + le sprint visé. Les sprints sont séquentiels : ne saute pas le 0.
2. **Itère hors CI.** Le harnais de test local (Sprint 0) te permet de rejouer des diffs sans pousser sur GitHub à chaque essai — c'est ce qui rend le développement rapide et pas cher.
3. **Le jeu de fixtures est ton garde-fou.** À chaque nouvelle catégorie, ajoute une fixture positive *et* une négative. La fixture négative protège contre les faux positifs, qui sont l'ennemi n°1 du projet.
4. **Calibre le prompt en dernier (Sprint 5), pas en premier.** D'abord le pipeline qui marche, ensuite l'affinage de la précision sur des cas réels.
5. **Étends le prompt et le schéma en parallèle.** Chaque nouvelle catégorie touche `prompt.ts` (la consigne + un few-shot) et `schema.ts` (l'enum `category`).
