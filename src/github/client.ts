import { getOctokit } from "@actions/github";

/**
 * Client GitHub typé.
 *
 * On passe par `getOctokit` (fourni par `@actions/github`) plutôt que par
 * `@octokit/rest` brut : il embarque déjà REST, GraphQL, la pagination et l'auth.
 */
export type Octokit = ReturnType<typeof getOctokit>;

export function createClient(token: string): Octokit {
  return getOctokit(token);
}
