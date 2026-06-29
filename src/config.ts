import * as core from "@actions/core";

/** Fournisseurs LLM supportés. */
export type ProviderName = "claude" | "gemini";

/**
 * Secrets et configuration runtime.
 *
 * Politique fail-fast : sans `GITHUB_TOKEN`, on échoue immédiatement. Le fournisseur se
 * choisit via `LLM_PROVIDER` (`claude`/`gemini`) ; si la variable est vide ou absente, on
 * **infère** le fournisseur depuis la clé API présente. L'absence de la clé du fournisseur
 * retenu ne déclenche qu'un avertissement (l'analyse est alors ignorée).
 */
export interface Config {
  githubToken: string;
  provider: ProviderName;
  /** Présente si le fournisseur Claude est utilisé. */
  anthropicApiKey?: string;
  /** Présente si le fournisseur Gemini est utilisé. */
  geminiApiKey?: string;
}

export function loadConfig(): Config {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error(
      "GITHUB_TOKEN manquant : impossible d'authentifier le client GitHub.",
    );
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const { provider, warning } = resolveProvider(
    process.env.LLM_PROVIDER,
    !!anthropicApiKey,
    !!geminiApiKey,
  );
  if (warning) core.warning(warning);

  const selectedKey = provider === "claude" ? anthropicApiKey : geminiApiKey;
  if (!selectedKey) {
    if (!anthropicApiKey && !geminiApiKey) {
      core.warning(
        "Aucune clé API définie (ni ANTHROPIC_API_KEY ni GEMINI_API_KEY) — analyse indisponible.",
      );
    } else {
      const envName = provider === "claude" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
      core.warning(
        `${envName} absente — fournisseur « ${provider} » sélectionné mais analyse indisponible.`,
      );
    }
  }

  return { githubToken, provider, anthropicApiKey, geminiApiKey };
}

/**
 * Détermine le fournisseur LLM. Fonction **pure** (sans log) pour être testable.
 *
 * - Une valeur explicite valide (`claude`/`gemini`, insensible à la casse) l'emporte toujours.
 * - Sinon (variable vide / absente / inconnue) : on **infère** depuis la clé disponible —
 *   si une seule des deux est définie, on prend ce fournisseur ; à défaut, repli sur `claude`.
 *   (Une variable GitHub non définie arrive comme chaîne vide, d'où l'inférence silencieuse.)
 */
export function resolveProvider(
  raw: string | undefined,
  hasClaudeKey: boolean,
  hasGeminiKey: boolean,
): { provider: ProviderName; warning?: string } {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "claude" || value === "gemini") {
    return { provider: value };
  }

  let provider: ProviderName = "claude";
  if (hasGeminiKey && !hasClaudeKey) provider = "gemini";

  const warning =
    value === ""
      ? undefined
      : `LLM_PROVIDER="${raw}" inconnu — détection automatique : « ${provider} ».`;
  return { provider, warning };
}
