import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  AiAttemptLog,
  AiAutofillMeta,
  AiAutofillResponse,
  AiCapabilities,
  AiChatInput,
  AiChatTurn,
  AiOcrInput,
  AiOcrResult,
  AiProvider,
  AiVisionInput,
  AiVisionResult,
  ArtistAutofillInput,
  ArtistAutofillResult,
  ArtworkAutofillInput,
  ArtworkAutofillResult,
  DescribeInput,
  DescribeResult,
  FindImagesInput,
  FindImagesResult,
  TranslateInput,
} from './ai.types';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CryptoService } from '../../core/crypto/crypto.service';
import { stripFillerFields } from '../../common/ai-filler.util';
import { getCachedOrg } from './org-ai-settings-cache.util';

interface OrgAiSettings {
  enabled?: boolean;
  geminiApiKeyEnc?: string;
}

/** Extracts the first balanced {...} block — Gemini, like OpenRouter models, sometimes wraps JSON in markdown fences. */
function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Délai dépassé (timeout après 30s)';
    // Keep whatever detail callModel() appended after "HTTP <code>" (Google's
    // actual error body) instead of replacing it with a generic sentence —
    // that detail is what tells a real exhausted quota apart from "this
    // key/project isn't fully provisioned yet" or "billing required".
    const detail = err.message.replace(/^HTTP \d+\s*/, '').replace(/^—\s*/, '');
    if (err.message.includes('400')) return `Requête invalide ou clé API Gemini refusée (400)${detail ? ` — ${detail}` : ''}`;
    if (err.message.includes('403')) return `Clé API Gemini invalide ou refusée (403)${detail ? ` — ${detail}` : ''}`;
    if (err.message.includes('429')) return `Limite de requêtes Gemini atteinte (429)${detail ? ` — ${detail}` : ''}`;
    if (/^HTTP \d+/.test(err.message)) return err.message.replace(/^HTTP (\d+)/, 'Le serveur Gemini a répondu avec une erreur ($1)');
    return err.message;
  }
  return String(err);
}

/**
 * Google Gemini (AI Studio) provider — the free-tier fallback for OpenRouter.
 * Has its own native Google Search grounding tool, so it can do the same
 * "find real facts via web search" job as OpenRouter's paid "web" plugin,
 * at no extra per-call fee on top of the (generous) Gemini free tier.
 */
export class GeminiAiProvider implements AiProvider {
  readonly id = 'gemini';
  readonly enabled = true;
  private readonly logger = new Logger(GeminiAiProvider.name);

  private readonly envApiKey: string;
  private readonly model: string;

  constructor(
    envApiKey: string,
    model: string,
    private readonly prisma?: PrismaService,
    private readonly crypto?: CryptoService,
  ) {
    this.envApiKey = envApiKey;
    this.model = model || 'gemini-2.0-flash';
  }

  private async resolveOrgSettings(organizationId?: string): Promise<OrgAiSettings | null> {
    if (!organizationId || !this.prisma) return null;
    try {
      // Same row is independently re-fetched by isEnabled() and by the actual
      // completion call within one request — cached briefly to cut that to a
      // single DB read, with no change to what's returned.
      const org = await getCachedOrg(organizationId, () => this.prisma!.organization.findUnique({ where: { id: organizationId } }));
      return ((org?.settings as Record<string, unknown>)?.ai as OrgAiSettings | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private async resolveApiKey(org: OrgAiSettings | null): Promise<string> {
    if (org?.geminiApiKeyEnc && this.crypto) {
      try {
        return this.crypto.decrypt(org.geminiApiKeyEnc);
      } catch {
        // fall through to env key
      }
    }
    return this.envApiKey;
  }

  /** True once an API key is resolvable, either org-configured or the env default — unlike OpenRouter there's no separate org enabled toggle, Gemini is purely "is a key configured". */
  async isEnabled(organizationId?: string): Promise<boolean> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    return Boolean(apiKey);
  }

  capabilities(): AiCapabilities {
    return { describe: true, tag: false, ocr: false, signature: false, compare: false, similar: false, classify: false, chat: false, vision: false };
  }

  /** Parses Google's RESOURCE_EXHAUSTED error body for the RetryInfo.retryDelay hint (e.g. "21s") it includes when the limit is about to reset — falls back to a fixed backoff when absent. */
  private parseRetryDelayMs(errorBody: string): number | null {
    try {
      const parsed = JSON.parse(errorBody) as {
        error?: { details?: Array<{ '@type'?: string; retryDelay?: string }> };
      };
      const retryInfo = parsed.error?.details?.find((d) => d['@type']?.includes('RetryInfo'));
      const match = retryInfo?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
      if (match) return Math.ceil(parseFloat(match[1]!) * 1000);
    } catch {
      // no structured retry hint — caller falls back to a fixed delay
    }
    return null;
  }

  private async callModelOnce(apiKey: string, systemPrompt: string, userMessage: string, webSearch: boolean): Promise<string> {
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: userMessage }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0 },
    };
    if (webSearch) {
      body.tools = [{ googleSearch: {} }];
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      // Google's error body carries the actual reason (e.g. quota metric/limit
      // exceeded, API not enabled for this project, billing required) — the
      // bare HTTP status alone ("429") isn't enough to tell a real exhausted
      // quota apart from "this key/project isn't fully provisioned yet".
      const errorBody = await res.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
        if (parsed.error?.message) detail = ` — ${parsed.error.message}`;
      } catch {
        if (errorBody) detail = ` — ${errorBody.slice(0, 200)}`;
      }
      const err = new Error(`HTTP ${res.status}${detail}`);
      if (res.status === 429) (err as Error & { retryDelayMs?: number }).retryDelayMs = this.parseRetryDelayMs(errorBody) ?? undefined;
      throw err;
    }
    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('\n');
    if (!text) {
      throw new Error('Réponse reçue mais format inattendu (candidates[0].content manquant)');
    }
    return text;
  }

  /**
   * One retry on a 429, honoring Google's own RetryInfo.retryDelay hint when
   * present (capped at 10s to keep a single user-facing call responsive) or a
   * fixed 3s backoff otherwise — covers the common case of a transient burst
   * limit rather than a genuinely exhausted daily quota, instead of failing
   * the whole enrichment on the first rate-limit blip.
   */
  private async callModel(apiKey: string, systemPrompt: string, userMessage: string, webSearch: boolean): Promise<string> {
    try {
      return await this.callModelOnce(apiKey, systemPrompt, userMessage, webSearch);
    } catch (e) {
      const retryDelayMs = (e as Error & { retryDelayMs?: number })?.retryDelayMs;
      if (!(e instanceof Error) || !e.message.includes('429')) throw e;
      const delay = Math.min(retryDelayMs ?? 3_000, 10_000);
      this.logger.warn(`Gemini 429 — nouvelle tentative dans ${delay}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.callModelOnce(apiKey, systemPrompt, userMessage, webSearch);
    }
  }

  private async completeJson<T extends object>(
    organizationId: string | undefined,
    systemPrompt: string,
    userMessage: string,
    webSearch: boolean,
  ): Promise<{ data: T; meta: AiAutofillMeta }> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      const message = "Aucune clé API Gemini configurée — impossible d'appeler Gemini.";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    const attempts: AiAttemptLog[] = [];
    try {
      const text = await this.callModel(apiKey, systemPrompt, userMessage, webSearch);
      const block = extractJsonBlock(text);
      if (!block) {
        attempts.push({ model: this.model, success: false, message: `Réponse reçue de Gemini ("${this.model}") mais aucun JSON exploitable.`, provider: 'gemini' });
        return { data: {} as T, meta: { fallbackUsed: false, attempts, message: attempts[0]!.message, hasUsableData: false } };
      }
      const parsed = stripFillerFields(JSON.parse(block) as Record<string, unknown>);
      const fieldCount = Object.values(parsed).filter(
        (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0),
      ).length;
      const message =
        fieldCount > 0
          ? `Réponse reçue avec succès de Gemini (modèle : ${this.model}, ${fieldCount} champ${fieldCount > 1 ? 's' : ''}).`
          : `Réponse reçue de Gemini ("${this.model}") mais sans information exploitable.`;
      attempts.push({ model: this.model, success: fieldCount > 0, message, provider: 'gemini' });
      return { data: parsed as T, meta: { modelUsed: this.model, fallbackUsed: false, attempts, message, hasUsableData: fieldCount > 0 } };
    } catch (e) {
      const reason = describeError(e);
      const message = `Échec appel Gemini ("${this.model}") : ${reason}`;
      this.logger.warn(message);
      attempts.push({ model: this.model, success: false, message, provider: 'gemini' });
      return { data: {} as T, meta: { fallbackUsed: false, attempts, message, hasUsableData: false } };
    }
  }

  async describe(input: DescribeInput): Promise<DescribeResult> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Return ONLY a JSON object: {"description": "...", "keywords": [...], "suggestedCategory": "..."}`;
    const { data } = await this.completeJson<DescribeResult>(input.organizationId, systemPrompt, 'Describe this artwork for cataloguing purposes.', false);
    return { description: data.description ?? '', keywords: data.keywords ?? [], suggestedCategory: data.suggestedCategory };
  }

  async autofillArtwork(input: ArtworkAutofillInput): Promise<AiAutofillResponse<ArtworkAutofillResult>> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
The most reliable sources for a specific, named work are: (1) the artist's own official website ("œuvres"/"catalogue raisonné" page); (2) auction house listings (Artnet, Invaluable, lot PDFs) — exact technique, dimensions, signature placement; (3) museum/gallery pages. Prefer these over your own memory.
If a dimension is found (e.g. "46x38 cm"), split it into heightCm (first number) and widthCm (second number) in centimeters, alongside dimensionsNote with the raw text.
If a real, working image URL for this exact work is found in the search results below, include it as imageUrl — never invent one.
Only state facts you are actually confident about — leave a field out entirely rather than guessing.
CRITICAL: if nothing useful is found for a field, OMIT that key entirely. Never write a sentence about not finding something as a field's value.
Return ONLY a JSON object with any of: description, techniqueName, dateText, yearFrom (number), heightCm (number), widthCm (number), dimensionsNote, signatureDescription, condition, tags (string array), imageUrl.`;
    const userMessage = `Title: ${input.title ?? '(unknown)'}\nArtist: ${input.artistName ?? '(unknown)'}` +
      (input.searchContext ? `\n\n${input.searchContext}` : '');
    return this.completeJson<ArtworkAutofillResult>(input.organizationId, systemPrompt, userMessage, false);
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    const systemPrompt = `You are an art database assistant. Respond in language code: ${input.locale}.
STRICT SOURCING RULE: use ONLY facts explicitly stated in the search results provided. Do NOT draw on your training-data knowledge of this artist — training data about lesser-known or regional artists is frequently wrong, confused with other artists of similar names, or entirely fabricated. If a fact is not clearly present in the search results, omit that field entirely.
If the search results are absent or contain nothing useful about this specific person, return an empty JSON object {}.
If a real portrait URL is found in the search results, include it as imageUrl — never invent or guess a URL.
Never invent dates, nationalities, schools, or biographies — a missing field is always better than a wrong one.
Return ONLY a JSON object with any subset of: biography, nationality, birthDate, deathDate, movement, imageUrl.`;
    const userMessage = `Artist: ${input.fullName}` +
      (input.searchContext ? `\n\n${input.searchContext}` : '');
    return this.completeJson<ArtistAutofillResult>(input.organizationId, systemPrompt, userMessage, false);
  }

  async findImages(input: FindImagesInput): Promise<AiAutofillResponse<FindImagesResult>> {
    const systemPrompt = `Extract real, working image URLs from the search results provided below.
Find as many DIFFERENT image URLs as you can (up to 6) showing the exact subject of this query — actual photos found in the results, never a generic stock photo, never invented.
CRITICAL: if nothing useful is found, OMIT the key entirely.
Return ONLY a JSON object: {"imageUrls": ["...", ...]}`;
    const userMessage = input.query + (input.searchContext ? `\n\n${input.searchContext}` : '');
    return this.completeJson<FindImagesResult>(input.organizationId, systemPrompt, userMessage, false);
  }

  /** Best-effort text translation — never throws, returns null so the caller (enrichment) just skips that locale on failure. */
  async translate(input: TranslateInput): Promise<string | null> {
    const org = await this.resolveOrgSettings(input.organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) return null;
    const systemPrompt =
      `You are a professional translator. Translate the user's text into language code "${input.targetLocale}"` +
      (input.sourceLocale ? ` (source language code: "${input.sourceLocale}").` : '.') +
      ' Return ONLY the translated text — no quotes, no explanation, no markdown, no preamble.';
    try {
      const text = await this.callModel(apiKey, systemPrompt, input.text, false);
      return text.trim() || null;
    } catch (e) {
      this.logger.warn(`Traduction Gemini vers "${input.targetLocale}" échouée : ${describeError(e)}`);
      return null;
    }
  }

  /** Settings → AI "Tester la connexion" — exactly one minimal request, no JSON parsing, no web search, real error surfaced instead of swallowed. */
  async testConnection(organizationId?: string): Promise<{ success: boolean; message: string }> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      return { success: false, message: 'Aucune clé API Gemini configurée.' };
    }
    try {
      const text = await this.callModel(apiKey, 'Reply with exactly: OK', 'Test.', false);
      return { success: true, message: `Connexion Gemini réussie (modèle : ${this.model}). Réponse : "${text.trim().slice(0, 60)}"` };
    } catch (e) {
      return { success: false, message: `Échec Gemini (modèle : ${this.model}) : ${describeError(e)}` };
    }
  }

  async ocr(_input: AiOcrInput): Promise<AiOcrResult> {
    throw new ServiceUnavailableException('OCR not supported by Gemini provider');
  }

  async tags(_input: DescribeInput): Promise<string[]> {
    throw new ServiceUnavailableException('Tagging not supported by Gemini provider');
  }

  /** Function calling needs a Gemini-specific functionDeclarations translation — deferred; the chain skips providers with chat: false. */
  async chat(_input: AiChatInput): Promise<AiChatTurn> {
    throw new ServiceUnavailableException("Le chat n'est pas encore supporté par le fournisseur Gemini.");
  }

  async analyzeImage(_input: AiVisionInput): Promise<AiVisionResult> {
    throw new ServiceUnavailableException("L'analyse d'image n'est pas encore supportée par le fournisseur Gemini.");
  }
}
