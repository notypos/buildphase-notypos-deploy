// Server-only LLM dispatch. Ported from the Week 3 project and extended with
// zod-validated structured output.
//
// Retry policy (unchanged from Week 3, it was already right):
//   429 rate limit    -> short backoff 1s / 2s / 4s
//   5xx / network     -> long backoff 5s / 10s / 20s  (let the model recover)
//   config + 404      -> surface immediately, retrying can't help
import 'server-only';
import { GoogleGenAI } from '@google/genai';
import type { ZodType } from 'zod';
import { type ProviderId, defaultOption, findModelOption } from './models';

const TRUSSED_DEFAULT_BASE = 'https://fauengtrussed.fau.edu/provider/generic';

interface ProviderSpec {
  kind: 'google' | 'openai';
  apiKeyEnv: string;
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
}

const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  google: { kind: 'google', apiKeyEnv: 'GEMINI_API_KEY' },
  'trussed-openai': {
    kind: 'openai',
    apiKeyEnv: 'TRUSSED_API_KEY_OPENAI',
    baseUrlEnv: 'TRUSSED_BASE_URL',
    defaultBaseUrl: TRUSSED_DEFAULT_BASE,
  },
  'trussed-gemini': {
    kind: 'openai',
    apiKeyEnv: 'TRUSSED_API_KEY_GEMINI',
    baseUrlEnv: 'TRUSSED_BASE_URL',
    defaultBaseUrl: TRUSSED_DEFAULT_BASE,
  },
};

export class LlmError extends Error {
  status?: number;
  code?: string;
  /** Safe to show a user verbatim. */
  userMessage: string;
  constructor(message: string, opts: { status?: number; code?: string; userMessage?: string } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = opts.status;
    this.code = opts.code;
    this.userMessage = opts.userMessage ?? message;
  }
}

function providerConfig(providerId: ProviderId) {
  const p = PROVIDERS[providerId];
  if (!p) {
    throw new LlmError(`Unknown model provider: ${providerId}`, {
      code: 'PROVIDER_UNKNOWN',
      userMessage: 'That model is not available.',
    });
  }
  const apiKey = process.env[p.apiKeyEnv];
  if (!apiKey) {
    throw new LlmError(`${p.apiKeyEnv} missing`, {
      code: 'PROVIDER_NOT_CONFIGURED',
      userMessage: 'This model is not configured on the server yet.',
    });
  }
  const baseUrl = p.baseUrlEnv ? process.env[p.baseUrlEnv] || p.defaultBaseUrl : undefined;
  return { kind: p.kind, apiKey, baseUrl };
}

/**
 * Bound a promise's wall-clock time. Prevents a hung model call from eating the
 * whole serverless budget and getting the function killed by Vercel.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new LlmError(`${label} timed out after ~${Math.round(ms / 1000)}s.`, {
            status: 504,
            userMessage: 'That took too long. Try again in a moment.',
          }),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** An inline image for a vision-capable request. Base64, no data: prefix. */
export interface GenerateImage {
  mimeType: string;
  dataBase64: string;
}

interface GenerateArgs {
  apiKey: string;
  baseUrl?: string;
  model: string;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  json: boolean;
  timeoutMs: number;
  image?: GenerateImage;
}

async function googleGenerate(a: GenerateArgs): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: a.apiKey });
  const config: Record<string, unknown> = {
    systemInstruction: a.system,
    temperature: a.temperature,
    maxOutputTokens: a.maxTokens,
  };
  if (a.json) config.responseMimeType = 'application/json';

  // Vision requests build a multipart content: the prompt text plus one
  // inline image. Text-only requests keep passing a plain string, unchanged
  // from before this was added.
  const contents = a.image
    ? [
        {
          role: 'user' as const,
          parts: [{ text: a.prompt }, { inlineData: { mimeType: a.image.mimeType, data: a.image.dataBase64 } }],
        },
      ]
    : a.prompt;

  const resp = await withTimeout(
    ai.models.generateContent({ model: a.model, contents, config }),
    a.timeoutMs,
    `Google ${a.model}`,
  );

  const u = resp.usageMetadata ?? {};
  console.log(
    `[tokens ${a.model}] prompt=${u.promptTokenCount ?? 0} output=${u.candidatesTokenCount ?? 0} total=${u.totalTokenCount ?? 0}`,
  );
  return resp.text ?? '';
}

async function openaiGenerate(a: GenerateArgs): Promise<string> {
  // Standard OpenAI vision content-block format: content becomes an array of
  // {type: 'text'} / {type: 'image_url'} parts instead of a plain string.
  // Whether Trussed's proxy actually forwards this to a vision-capable
  // backend is unverified until tested — a failure here should surface
  // clearly so the caller can fall back to another model, not be swallowed.
  const userContent = a.image
    ? [
        { type: 'text', text: a.prompt },
        { type: 'image_url', image_url: { url: `data:${a.image.mimeType};base64,${a.image.dataBase64}` } },
      ]
    : a.prompt;

  const body: Record<string, unknown> = {
    model: a.model,
    messages: [
      { role: 'system', content: a.system },
      { role: 'user', content: userContent },
    ],
    temperature: a.temperature,
    max_tokens: a.maxTokens,
  };
  if (a.json) body.response_format = { type: 'json_object' };

  const res = await withTimeout(
    fetch(`${a.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    a.timeoutMs,
    `Trussed ${a.model}`,
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message: string;
    let userMessage = 'The model is unavailable right now. Please try again.';
    if (res.status === 404) {
      message = `Model "${a.model}" is not on the Trussed allowlist.`;
    } else if (res.status === 401 || res.status === 403) {
      message = `Trussed rejected the API key (${res.status}) for "${a.model}" — expired or out of budget.`;
    } else if (res.status === 429) {
      message = `Rate limited by Trussed for "${a.model}".`;
      userMessage = 'Too many requests right now. Give it a few seconds.';
    } else if (res.status === 400 && a.image) {
      message = `Trussed rejected the image request for "${a.model}" (400) — likely no vision support: ${detail.slice(0, 200)}`;
    } else {
      message = `Model call failed (${res.status}). ${detail.slice(0, 200)}`;
    }
    throw new LlmError(message, { status: res.status, userMessage });
  }

  const data = await res.json();
  const u = data?.usage ?? {};
  console.log(
    `[tokens ${a.model}] prompt=${u.prompt_tokens ?? 0} output=${u.completion_tokens ?? 0} total=${u.total_tokens ?? 0}`,
  );
  return data?.choices?.[0]?.message?.content ?? '';
}

export interface GenerateOptions {
  modelId?: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
  /** Attach one image to the request. Supported by all providers; unverified
   * for Trussed until tested against a live vision-capable backend. */
  image?: GenerateImage;
}

/** Raw text generation with retry. */
export async function generate(opts: GenerateOptions): Promise<string> {
  const option = opts.modelId ? findModelOption(opts.modelId) : defaultOption();
  const cfg = providerConfig(option.providerId);

  const rateLimitDelays = [1000, 2000, 4000];
  const overloadDelays = [5000, 10000, 20000];
  let attempt = 0;

  for (;;) {
    try {
      const args: GenerateArgs = {
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: option.model,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.2,
        maxTokens: opts.maxTokens ?? 4096,
        json: opts.json ?? false,
        timeoutMs: opts.timeoutMs ?? 45000,
        image: opts.image,
      };
      return cfg.kind === 'google' ? await googleGenerate(args) : await openaiGenerate(args);
    } catch (err) {
      const status = (err as LlmError).status;
      const code = (err as LlmError).code;
      if (code === 'PROVIDER_UNKNOWN' || code === 'PROVIDER_NOT_CONFIGURED') throw err;

      const is429 = status === 429;
      const is5xx = !status || (status >= 500 && status !== 501);
      const delays = is429 ? rateLimitDelays : overloadDelays;
      if (!(is429 || is5xx) || attempt >= delays.length) throw err;

      console.warn(
        `[llm ${option.id}] attempt ${attempt + 1} failed (${status ?? 'network'}); retrying in ${delays[attempt] / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, delays[attempt]));
      attempt++;
    }
  }
}

function stripFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/**
 * Generate and validate against a zod schema. Every structured feature —
 * evidence cards, claim verdicts, agent findings — goes through here so a
 * malformed model response becomes a typed error instead of a runtime crash
 * three layers up. One reprompt on a validation failure, then give up.
 */
export async function generateStructured<T>(
  schema: ZodType<T>,
  opts: GenerateOptions,
): Promise<T> {
  let lastIssue = '';

  for (let pass = 0; pass < 2; pass++) {
    const prompt =
      pass === 0
        ? opts.prompt
        : `${opts.prompt}\n\nYour previous reply did not match the required JSON shape (${lastIssue}). Reply with valid JSON only, no prose, no code fences.`;

    const raw = await generate({ ...opts, prompt, json: true });

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      lastIssue = 'response was not valid JSON';
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    lastIssue = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 300);
  }

  throw new LlmError(`Structured output failed validation: ${lastIssue}`, {
    code: 'SCHEMA_VALIDATION_FAILED',
    userMessage: "The model returned something I couldn't read. Please try again.",
  });
}
