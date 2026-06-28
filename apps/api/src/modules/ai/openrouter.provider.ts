import type {
  AiAttemptLog,
  AiAutofillMeta,
  AiAutofillResponse,
  AiCapabilities,
  AiProvider,
  ArtistAutofillInput,
  ArtistAutofillResult,
  ArtworkAutofillInput,
  ArtworkAutofillResult,
  DescribeInput,
  DescribeResult,
  TranslateInput,
} from './ai.types';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CryptoService } from '../../core/crypto/crypto.service';

interface OrgAiSettings {
  enabled?: boolean;
  openrouterApiKeyEnc?: string;
  models?: string[];
}

interface CompletionOutcome {
  text: string;
  meta: AiAutofillMeta;
}

/** Extracts the first balanced {...} block from text that may be wrapped in markdown fences, prose, etc. */
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

/** Human-readable reason for a failed model call — never a raw stack trace or JSON blob. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Délai dépassé (timeout après 30s)';
    if (err.message.includes('401')) return 'Clé API invalide ou refusée (401)';
    if (err.message.includes('429')) return 'Limite de requêtes OpenRouter atteinte (429)';
    if (/^HTTP \d+/.test(err.message)) return err.message.replace(/^HTTP (\d+)$/, 'Le serveur OpenRouter a répondu avec une erreur ($1)');
    return err.message;
  }
  return String(err);
}

/**
 * OpenRouter provider – a thin wrapper around the OpenRouter chat completions API.
 * Both the API key and the model list can be overridden per-organization from
 * Settings → AI (stored encrypted on Organization.settings.ai) — falling back
 * to the env-configured OPENROUTER_API_KEY / OPENROUTER_MODEL when an org
 * hasn't set its own. When multiple models are configured, the provider calls
 * each in order and returns the first successful result — this is the
 * "switch to the next AI when one stops working" failover the org admin
 * configures from the UI. Every attempt (success or failure) is logged in
 * human terms — both to the server log and back to the caller — so a click
 * on an "AI" button in the UI never resolves to a silent, unexplained no-op.
 */
export class OpenRouterAiProvider implements AiProvider {
  readonly id = 'openrouter';
  readonly enabled = true;
  private readonly logger = new Logger(OpenRouterAiProvider.name);

  private readonly envApiKey: string;
  private readonly envModels: string[];

  constructor(
    envApiKey: string,
    modelList: string,
    private readonly prisma?: PrismaService,
    private readonly crypto?: CryptoService,
  ) {
    this.envApiKey = envApiKey;
    // Accept a comma‑separated list of model IDs, e.g. "openrouter/auto,openrouter/mistral-7b"
    this.envModels = modelList.split(',').map((m) => m.trim()).filter(Boolean);
  }

  private async resolveOrgSettings(organizationId?: string): Promise<OrgAiSettings | null> {
    if (!organizationId || !this.prisma) return null;
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      return ((org?.settings as Record<string, unknown>)?.ai as OrgAiSettings | undefined) ?? null;
    } catch {
      return null;
    }
  }

  /** True once enabled at the org level (or via env, when no org context applies) AND an API key is resolvable either way. */
  async isEnabled(organizationId?: string): Promise<boolean> {
    const org = await this.resolveOrgSettings(organizationId);
    if (org) return Boolean(org.enabled && (org.openrouterApiKeyEnc || this.envApiKey));
    return Boolean(this.envApiKey);
  }

  private async resolveApiKey(org: OrgAiSettings | null): Promise<string> {
    if (org?.openrouterApiKeyEnc && this.crypto) {
      try {
        return this.crypto.decrypt(org.openrouterApiKeyEnc);
      } catch {
        // fall through to env key
      }
    }
    return this.envApiKey;
  }

  /** Org-chosen models (Settings → AI) take priority over the env-configured default list. */
  private resolveModels(org: OrgAiSettings | null): string[] {
    if (org?.models?.length) return org.models;
    return this.envModels.length ? this.envModels : ['openrouter/auto'];
  }

  capabilities(): AiCapabilities {
    return {
      describe: true,
      tag: false,
      ocr: false,
      signature: false,
      compare: false,
      similar: false,
      classify: false,
    };
  }

  private async callModel(
    model: string,
    apiKey: string,
    systemPrompt: string,
    userMessage: string,
    opts?: { webSearch?: boolean },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.0,
    };
    // OpenRouter's "web" plugin runs a real search (via Exa) and injects the
    // results into the prompt before the model answers — without this, the
    // model only ever has whatever it memorized during training, which is
    // nothing for most real-world/regional/private-collection artists and
    // routinely produces a generic guess (e.g. "female nude") instead of the
    // actual catalogue facts (technique, dimensions, catalogue raisonné #).
    if (opts?.webSearch) {
      body.plugins = [{ id: 'web', max_results: 5 }];
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Réponse reçue mais format inattendu (choices[0].message.content manquant)');
    }
    return content;
  }

  /** Tries each org/env-configured model in order — the "switch to the next AI" failover — logging every attempt in human terms. */
  private async completeWithFailover(
    organizationId: string | undefined,
    systemPrompt: string,
    userMessage: string,
    opts?: { webSearch?: boolean },
  ): Promise<CompletionOutcome> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    const attempts: AiAttemptLog[] = [];

    if (!apiKey) {
      const message = "Aucune clé API OpenRouter configurée — impossible d'appeler l'IA.";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    const models = this.resolveModels(org);
    this.logger.log(`Appel IA — modèles configurés, par ordre de priorité : ${models.join(', ')}`);

    for (const model of models) {
      try {
        const text = await this.callModel(model, apiKey, systemPrompt, userMessage, opts);
        const successMessage = `Réponse reçue avec succès du modèle "${model}"`;
        attempts.push({ model, success: true, message: successMessage });
        this.logger.log(successMessage);
        const fallbackUsed = attempts.length > 1;
        const message = fallbackUsed
          ? `Modèle principal indisponible — bascule sur "${model}" réussie.`
          : `Réponse IA reçue correctement depuis OpenRouter (modèle : ${model}). Fallback non utilisé.`;
        return {
          text,
          meta: { modelUsed: model, fallbackUsed, attempts, message, hasUsableData: false },
        };
      } catch (e) {
        const reason = describeError(e);
        const failMessage = `Échec appel modèle "${model}" : ${reason}`;
        attempts.push({ model, success: false, message: failMessage });
        this.logger.warn(failMessage);
      }
    }

    const message = `Tous les modèles ont échoué (${attempts.length}/${attempts.length}) : ${attempts.map((a) => a.message).join(' | ')}`;
    this.logger.error(message);
    throw new ServiceUnavailableException(message);
  }

  /** Parses the model's JSON response defensively, never silently swallowing a malformed reply. */
  private parseJsonResult<T extends object>(text: string, meta: AiAutofillMeta): T {
    const block = extractJsonBlock(text);
    if (!block) {
      meta.message += ' — Réponse reçue mais aucun JSON exploitable trouvé dans le texte renvoyé par le modèle.';
      this.logger.warn(`Parsing JSON impossible — contenu brut reçu (tronqué) : ${text.slice(0, 200)}`);
      return {} as T;
    }
    try {
      const parsed = JSON.parse(block) as T;
      const fieldCount = Object.values(parsed).filter((v) => v !== undefined && v !== null && v !== '').length;
      if (fieldCount === 0) {
        meta.message += ' — Réponse extraite mais entièrement vide (le modèle ne connaît probablement pas ce sujet).';
      } else {
        meta.message += ` — Réponse extraite avec succès et envoyée à l'UI (${fieldCount} champ${fieldCount > 1 ? 's' : ''}).`;
        meta.hasUsableData = true;
      }
      return parsed;
    } catch (e) {
      meta.message += ` — Réponse reçue mais JSON invalide (${(e as Error).message}).`;
      this.logger.warn(`JSON.parse a échoué sur le bloc extrait (tronqué) : ${block.slice(0, 200)}`);
      return {} as T;
    }
  }

  async describe(input: DescribeInput): Promise<DescribeResult> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Return ONLY a JSON object: {"description": "...", "keywords": [...], "suggestedCategory": "..."}`;
    const { text } = await this.completeWithFailover(input.organizationId, systemPrompt, 'Describe this artwork for cataloguing purposes.');
    const block = extractJsonBlock(text);
    if (!block) return { description: text, keywords: [], suggestedCategory: undefined };
    try {
      return JSON.parse(block) as DescribeResult;
    } catch {
      return { description: text, keywords: [], suggestedCategory: undefined };
    }
  }

  async autofillArtwork(input: ArtworkAutofillInput): Promise<AiAutofillResponse<ArtworkAutofillResult>> {
    const systemPrompt = `You are an expert art cataloguer with access to real-time web search results for this query.
Respond in language code: ${input.locale}.
Search results may include the artist's official website, a catalogue raisonné, an auction house listing, or a museum/gallery page — use them to extract precise, sourced facts (technique/medium, exact dimensions, date, catalogue raisonné number, where and how the work is signed) rather than a generic guess.
Only state facts you are actually confident about for this specific, named work — leave a field out entirely rather than guessing or inventing a number you didn't see in a source.
Return ONLY a JSON object with any of: description, techniqueName, dateText, yearFrom (number), dimensionsNote (e.g. "46x38 cm"), signatureDescription (e.g. "signé en bas à droite : B. DUBAIL"), condition, tags (string array).`;
    const userMessage = `Title: ${input.title ?? '(unknown)'}\nArtist: ${input.artistName ?? '(unknown)'}`;
    const { text, meta } = await this.completeWithFailover(input.organizationId, systemPrompt, userMessage, { webSearch: true });
    const data = this.parseJsonResult<ArtworkAutofillResult>(text, meta);
    return { data, meta };
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    const systemPrompt = `You are an art historian with access to real-time web search results for this query.
Respond in language code: ${input.locale}.
Search results may include Wikipedia, museum biographies, auction house artist pages, or the artist's official site — use them to ground your answer in actual sourced facts rather than a generic guess.
Only state facts you are actually confident about for this specific person — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: biography, nationality, birthDate, deathDate, movement.`;
    const { text, meta } = await this.completeWithFailover(input.organizationId, systemPrompt, `Artist: ${input.fullName}`, { webSearch: true });
    const data = this.parseJsonResult<ArtistAutofillResult>(text, meta);
    return { data, meta };
  }

  /** Best-effort text translation — never throws, returns null so the caller (enrichment) just skips that locale on failure. */
  async translate(input: TranslateInput): Promise<string | null> {
    const systemPrompt =
      `You are a professional translator. Translate the user's text into language code "${input.targetLocale}"` +
      (input.sourceLocale ? ` (source language code: "${input.sourceLocale}").` : '.') +
      ' Return ONLY the translated text — no quotes, no explanation, no markdown, no preamble.';
    try {
      const { text } = await this.completeWithFailover(input.organizationId, systemPrompt, input.text);
      const trimmed = text.trim();
      return trimmed || null;
    } catch (e) {
      this.logger.warn(`Traduction vers "${input.targetLocale}" échouée : ${describeError(e)}`);
      return null;
    }
  }

  // The other AI capabilities are not implemented for OpenRouter.
  async ocr(_imageUrl: string): Promise<string> {
    throw new ServiceUnavailableException('OCR not supported by OpenRouter provider');
  }

  async tags(_input: DescribeInput): Promise<string[]> {
    throw new ServiceUnavailableException('Tagging not supported by OpenRouter provider');
  }
}
