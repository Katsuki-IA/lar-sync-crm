// Chamada server-side ao provedor OpenAI existente para interpretar texto
// da secretária. Nunca importar em código de browser: a credencial e o modelo
// vivem apenas no servidor (OPENAI_API_KEY / SECRETARY_AI_MODEL).
import {
  buildInterpretationPrompt,
  parseInterpretationOutput,
  type SecretaryInterpretation,
  type SecretaryTone,
} from "./secretary-interpreter";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 10_000;

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "secretary_interpretation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        intent: { type: "string", enum: ["listar", "aceitar", "recusar", "desconhecido"] },
        reference: { type: ["string", "null"] },
      },
      required: ["intent", "reference"],
      additionalProperties: false,
    },
  },
} as const;

/**
 * Interpreta o texto do corretor. Qualquer falha (sem chave, timeout, erro
 * HTTP, saída malformada) retorna null — o chamador responde com a mensagem
 * de ajuda e não executa mutação alguma.
 */
export async function interpretSecretaryText(options: {
  text: string;
  tone: SecretaryTone;
  basePrompt?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<SecretaryInterpretation | null> {
  const apiKey = String(process.env["OPENAI_API_KEY"] ?? "").trim();
  if (!apiKey) return null;
  const model = String(process.env["SECRETARY_AI_MODEL"] ?? "").trim() || DEFAULT_MODEL;
  const fetcher = options.fetchImpl ?? fetch;
  try {
    const response = await fetcher(OPENAI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        response_format: RESPONSE_FORMAT,
        messages: [
          {
            role: "system",
            content: buildInterpretationPrompt({
              tone: options.tone,
              basePrompt: options.basePrompt,
            }),
          },
          { role: "user", content: options.text },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const content =
      payload &&
      typeof payload === "object" &&
      Array.isArray((payload as { choices?: unknown }).choices)
        ? ((
            (payload as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]
              ?.message?.content
          ) ?? null)
        : null;
    if (typeof content !== "string" || !content.trim()) return null;
    const parsed = parseInterpretationOutput(content);
    return parsed.intent === "desconhecido" && !content.includes("desconhecido") ? null : parsed;
  } catch {
    return null;
  }
}
