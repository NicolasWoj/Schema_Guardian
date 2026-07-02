import type { ChangedFile, Finding } from "../types";
import type { Config } from "../config";
import { createClaudeAnalyzer } from "./providers/claude";
import { createGeminiAnalyzer } from "./providers/gemini";

/**
 * Abstraction multi-fournisseur. Tout le pipeline ne dépend que de cette interface ;
 * brancher un nouveau LLM = ajouter une implémentation, sans toucher au reste.
 */
/** Tokens consommés par un appel d'analyse (journalisation des coûts, Sprint 5). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AnalysisResult {
  findings: Finding[];
  usage: TokenUsage;
}

export interface Analyzer {
  readonly provider: string;
  readonly model: string;
  /** `securityContext` : carte RLS + colonnes sensibles sérialisées, injectées après le diff. */
  analyze(files: ChangedFile[], securityContext?: string): Promise<AnalysisResult>;
}

/**
 * Construit l'analyzer du fournisseur sélectionné dans la config.
 * Renvoie `null` si la clé API de ce fournisseur est absente (l'appelant décide quoi faire).
 */
export function createAnalyzer(config: Config): Analyzer | null {
  if (config.provider === "claude") {
    return config.anthropicApiKey
      ? createClaudeAnalyzer(config.anthropicApiKey)
      : null;
  }
  if (config.provider === "gemini") {
    return config.geminiApiKey
      ? createGeminiAnalyzer(config.geminiApiKey)
      : null;
  }
  return null;
}
