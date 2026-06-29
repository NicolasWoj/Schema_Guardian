import * as core from "@actions/core";

/**
 * Secrets et configuration runtime.
 *
 * Politique fail-fast : sans `GITHUB_TOKEN`, on ne peut rien faire d'utile, donc on
 * échoue immédiatement avec un message clair. `ANTHROPIC_API_KEY` n'est pas encore
 * utilisée au Sprint 0 : son absence ne déclenche qu'un avertissement.
 */
export interface Config {
  githubToken: string;
  /** Présente à partir du Sprint 1 (analyse LLM). Optionnelle au Sprint 0. */
  anthropicApiKey: string | undefined;
}

export function loadConfig(): Config {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error(
      "GITHUB_TOKEN manquant : impossible d'authentifier le client GitHub.",
    );
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    core.warning(
      "ANTHROPIC_API_KEY absente — l'analyse LLM est indisponible (attendu au Sprint 0).",
    );
  }

  return { githubToken, anthropicApiKey };
}
