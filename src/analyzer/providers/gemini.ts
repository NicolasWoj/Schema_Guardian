import { GoogleGenAI, Type } from "@google/genai";
import type { Schema } from "@google/genai";
import { SYSTEM_PROMPT, buildUserMessage } from "../prompt";
import { CATEGORIES, SEVERITIES, FINDING_REQUIRED, validateFindings } from "../schema";
import type { Analyzer, AnalysisResult } from "../provider";
import type { Finding } from "../../types";

/**
 * Implémentation Gemini (Google).
 *
 * Sortie structurée via `responseSchema` + `responseMimeType: "application/json"` — l'analogue
 * du strict tool use de Claude. Le schéma Gemini est un sous-ensemble d'OpenAPI : on utilise
 * l'enum `Type` du SDK, pas d'`additionalProperties`.
 *
 * NB : Google a introduit une « Interactions API » plus récente. On reste ici sur
 * `models.generateContent`, stable et bien documenté ; le swap est local à ce fichier.
 *
 * Modèle par défaut `gemini-3.5-flash` (GA, fort sur le raisonnement). Surchargeable via
 * `GEMINI_MODEL` (ex. `gemini-2.5-flash` pour réduire le coût).
 */
const DEFAULT_MODEL = "gemini-3.5-flash";

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: [...CATEGORIES] },
          severity: { type: Type.STRING, enum: [...SEVERITIES] },
          file: { type: Type.STRING },
          line: { type: Type.INTEGER },
          title: { type: Type.STRING },
          explanation: { type: Type.STRING },
          suggested_fix: { type: Type.STRING },
        },
        required: [...FINDING_REQUIRED],
        propertyOrdering: [...FINDING_REQUIRED],
      },
    },
  },
  required: ["findings"],
};

export function createGeminiAnalyzer(
  apiKey: string,
  model: string = process.env.GEMINI_MODEL || DEFAULT_MODEL,
): Analyzer {
  const ai = new GoogleGenAI({ apiKey });

  return {
    provider: "gemini",
    model,
    async analyze(files, securityContext): Promise<AnalysisResult> {
      const response = await ai.models.generateContent({
        model,
        contents: buildUserMessage(files, securityContext),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });

      const usage = {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };

      const text = response.text;
      if (!text) return { findings: [], usage };

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Réponse Gemini illisible : JSON invalide.");
      }
      return { findings: validateFindings(parsed), usage };
    },
  };
}
