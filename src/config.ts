import * as core from "@actions/core";

/** Fournisseurs LLM supportés. */
export type ProviderName = "claude" | "gemini";

/**
 * Secrets et configuration runtime.
 *
 * Politique fail-fast : sans `GITHUB_TOKEN`, on échoue immédiatement. Le choix du
 * fournisseur se fait via `LLM_PROVIDER` (défaut `claude`) ; l'absence de la clé du
 * fournisseur sélectionné ne déclenche qu'un avertissement (l'analyse sera ignorée).
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

  const provider = parseProvider(process.env.LLM_PROVIDER);
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const selectedKey = provider === "claude" ? anthropicApiKey : geminiApiKey;
  if (!selectedKey) {
    const envName = provider === "claude" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
    core.warning(
      `${envName} absente — fournisseur « ${provider} » sélectionné mais analyse indisponible.`,
    );
  }

  return { githubToken, provider, anthropicApiKey, geminiApiKey };
}

/** Lit `LLM_PROVIDER` (insensible à la casse), repli sur `claude` si absent/inconnu. */
function parseProvider(raw: string | undefined): ProviderName {
  const value = (raw ?? "claude").trim().toLowerCase();
  if (value === "claude" || value === "gemini") return value;
  core.warning(`LLM_PROVIDER="${raw}" inconnu — repli sur « claude ».`);
  return "claude";
}
