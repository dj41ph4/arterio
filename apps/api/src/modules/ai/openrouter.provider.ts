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
  FindImagesInput,
  FindImagesResult,
  TranslateInput,
} from './ai.types';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CryptoService } from '../../core/crypto/crypto.service';
import { stripFillerFields } from '../../common/ai-filler.util';
import { getCachedOrg } from './org-ai-settings-cache.util';

interface OrgAiSettings {
  enabled?: boolean;
  openrouterApiKeyEnc?: string;
  models?: string[];
  /** 'parallel' (default): every configured model is queried at once and merged — most complete answer, but spends a call per model every time. 'fallback': models are tried one at a time, stopping at the first usable result — cheaper, costs the same as a single call unless that model fails. */
  multiModelMode?: 'parallel' | 'fallback';
  /** OFF by default. OpenRouter's "web" plugin (Exa search) bills per search even on :free models — the recurring 402 source. Free grounding instead comes from common/free-web-search.util.ts's searchContext, appended to the prompt. This flag is an explicit opt-in for users who accept the extra cost for OpenRouter's own search. */
  useOpenRouterWebPlugin?: boolean;
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

/**
 * Merges several models' parsed JSON answers for the same query into one.
 * "Most complete wins, gaps get filled in" — per field: arrays are unioned
 * and de-duplicated (case-insensitive); imageUrl keeps the first model's
 * answer in priority order (length tells us nothing about whether a URL is
 * real); every other scalar/string field keeps whichever model's answer is
 * longest, since a longer, more specific answer (an exact "huile et sable
 * sur toile, 46x38 cm" vs. a vague "oil on canvas") is what "most complete"
 * means here.
 */
function mergeAutofillResults(resultsInOrder: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set<string>();
  resultsInOrder.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));

  for (const key of keys) {
    const values = resultsInOrder
      .map((r) => r[key])
      .filter((v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (!values.length) continue;

    if (Array.isArray(values[0])) {
      const seen = new Set<string>();
      const deduped: unknown[] = [];
      for (const v of values.flat()) {
        const k = String(v).toLowerCase().trim();
        if (k && !seen.has(k)) {
          seen.add(k);
          deduped.push(v);
        }
      }
      merged[key] = deduped;
    } else if (key === 'imageUrl') {
      merged[key] = values[0];
    } else if (typeof values[0] === 'string') {
      merged[key] = (values as string[]).reduce((longest, v) => (v.length > longest.length ? v : longest));
    } else {
      merged[key] = values[0];
    }
  }
  return merged;
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
      // isEnabled() and the actual completion call each independently need
      // this same row within the same request — cached briefly so that's one
      // DB read instead of two or three, with no change to what's returned.
      const org = await getCachedOrg(organizationId, () => this.prisma!.organization.findUnique({ where: { id: organizationId } }));
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
        attempts.push({ model, success: true, message: successMessage, provider: 'openrouter' });
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
        attempts.push({ model, success: false, message: failMessage, provider: 'openrouter' });
        this.logger.warn(failMessage);
      }
    }

    const message = `Tous les modèles ont échoué (${attempts.length}/${attempts.length}) : ${attempts.map((a) => a.message).join(' | ')}`;
    this.logger.error(message);
    throw new ServiceUnavailableException(message);
  }

  /** Parses one model's raw text response into an attempt log + usable data (or null) — shared by both the parallel-merge and the sequential-fallback paths so they stay byte-identical in how they judge a response. */
  private parseModelAttempt(model: string, text: string): { attempt: AiAttemptLog; data: Record<string, unknown> | null } {
    const block = extractJsonBlock(text);
    if (!block) {
      return {
        attempt: { model, success: false, message: `Réponse reçue de "${model}" mais aucun JSON exploitable.`, provider: 'openrouter' },
        data: null,
      };
    }
    try {
      const parsed = stripFillerFields(JSON.parse(block) as Record<string, unknown>);
      const fieldCount = Object.values(parsed).filter(
        (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0),
      ).length;
      const attempt: AiAttemptLog = {
        model,
        success: fieldCount > 0,
        provider: 'openrouter',
        message:
          fieldCount > 0
            ? `Réponse reçue avec succès du modèle "${model}" (${fieldCount} champ${fieldCount > 1 ? 's' : ''}).`
            : `Réponse reçue du modèle "${model}" mais sans information exploitable (aucun résultat trouvé pour cette recherche).`,
      };
      return { attempt, data: fieldCount > 0 ? parsed : null };
    } catch (e) {
      return {
        attempt: { model, success: false, message: `Réponse reçue de "${model}" mais JSON invalide (${(e as Error).message}).`, provider: 'openrouter' },
        data: null,
      };
    }
  }

  /** Dispatches to the parallel-merge or sequential-fallback strategy per the org's configured multiModelMode (Settings → AI, default "parallel"). */
  private async completeMultiModel<T extends object>(
    organizationId: string | undefined,
    systemPrompt: string,
    userMessage: string,
    opts?: { webSearch?: boolean },
  ): Promise<{ data: T; meta: AiAutofillMeta }> {
    const org = await this.resolveOrgSettings(organizationId);
    if (org?.multiModelMode === 'fallback') {
      return this.completeWithModelFallback<T>(organizationId, systemPrompt, userMessage, opts);
    }
    return this.completeAndMergeJson<T>(organizationId, systemPrompt, userMessage, opts);
  }

  /**
   * Cheaper alternative to completeAndMergeJson: tries each configured model
   * ONE AT A TIME, by priority order, stopping at the first one that returns
   * usable data — costs exactly one model call in the common case (first
   * model succeeds), instead of always spending one call per configured
   * model. Trade-off: unlike the parallel/merge mode, a field only the
   * second model would have found is never picked up once the first model
   * already returned *something* usable.
   */
  private async completeWithModelFallback<T extends object>(
    organizationId: string | undefined,
    systemPrompt: string,
    userMessage: string,
    opts?: { webSearch?: boolean },
  ): Promise<{ data: T; meta: AiAutofillMeta }> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      const message = "Aucune clé API OpenRouter configurée — impossible d'appeler l'IA.";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    const models = this.resolveModels(org);
    this.logger.log(`Appel IA — mode économique, un modèle à la fois par ordre de priorité : ${models.join(', ')}`);

    const attempts: AiAttemptLog[] = [];
    for (const model of models) {
      let text: string;
      try {
        text = await this.callModel(model, apiKey, systemPrompt, userMessage, opts);
      } catch (e) {
        const reason = describeError(e);
        const failMessage = `Échec appel modèle "${model}" : ${reason}`;
        attempts.push({ model, success: false, message: failMessage, provider: 'openrouter' });
        this.logger.warn(failMessage);
        continue;
      }
      const { attempt, data } = this.parseModelAttempt(model, text);
      attempts.push(attempt);
      if (data) {
        const fieldCount = Object.keys(data).length;
        const fallbackUsed = attempts.length > 1;
        const message = fallbackUsed
          ? `Modèle précédent sans résultat exploitable — bascule sur "${model}" réussie (${fieldCount} champ${fieldCount > 1 ? 's' : ''}).`
          : `Réponse IA reçue correctement depuis OpenRouter (modèle : ${model}) — ${fieldCount} champ${fieldCount > 1 ? 's' : ''}.`;
        this.logger.log(message);
        return { data: data as T, meta: { modelUsed: model, fallbackUsed, attempts, message, hasUsableData: true } };
      }
    }

    const message = `Tous les modèles ont échoué ou n'ont rien trouvé (${attempts.length}/${attempts.length}) : ${attempts.map((a) => a.message).join(' | ')}`;
    this.logger.error(message);
    return { data: {} as T, meta: { fallbackUsed: attempts.length > 1, attempts, message, hasUsableData: false } };
  }

  /**
   * Calls every configured model with the SAME query simultaneously instead
   * of trying one and only falling back on outright failure — this is the
   * "let all 3 search and merge their findings" behavior: each model may
   * find a different subset of facts (one nails the dimensions, another
   * the signature), so instead of discarding 2 of 3 answers, every field is
   * kept from whichever model returned the fullest answer, and array
   * fields (tags) are unioned rather than overwritten.
   */
  private async completeAndMergeJson<T extends object>(
    organizationId: string | undefined,
    systemPrompt: string,
    userMessage: string,
    opts?: { webSearch?: boolean },
  ): Promise<{ data: T; meta: AiAutofillMeta }> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      const message = "Aucune clé API OpenRouter configurée — impossible d'appeler l'IA.";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    const models = this.resolveModels(org);
    this.logger.log(`Appel IA — interrogation simultanée de ${models.length} modèle(s) sur la même recherche : ${models.join(', ')}`);

    const attempts: AiAttemptLog[] = [];
    const settled = await Promise.allSettled(models.map((model) => this.callModel(model, apiKey, systemPrompt, userMessage, opts)));

    const parsedByModel: Array<{ model: string; data: Record<string, unknown> }> = [];
    settled.forEach((outcome, i) => {
      const model = models[i]!;
      if (outcome.status === 'rejected') {
        const reason = describeError(outcome.reason);
        attempts.push({ model, success: false, message: `Échec appel modèle "${model}" : ${reason}`, provider: 'openrouter' });
        this.logger.warn(`Échec appel modèle "${model}" : ${reason}`);
        return;
      }
      const { attempt, data } = this.parseModelAttempt(model, outcome.value);
      attempts.push(attempt);
      if (data) parsedByModel.push({ model, data });
    });

    if (!parsedByModel.length) {
      const message = `Tous les modèles ont échoué ou n'ont rien trouvé (${attempts.length}/${attempts.length}) : ${attempts.map((a) => a.message).join(' | ')}`;
      this.logger.error(message);
      return { data: {} as T, meta: { fallbackUsed: attempts.length > 1, attempts, message, hasUsableData: false } };
    }

    const merged = mergeAutofillResults(parsedByModel.map((r) => r.data));
    const fieldCount = Object.keys(merged).length;
    const contributingModels = parsedByModel.map((r) => r.model);
    const message =
      parsedByModel.length > 1
        ? `Réponses fusionnées de ${parsedByModel.length} modèles (${contributingModels.join(', ')}) — ${fieldCount} champ${fieldCount > 1 ? 's' : ''} au total, en gardant la donnée la plus complète pour chaque champ.`
        : `Réponse IA reçue correctement depuis OpenRouter (modèle : ${contributingModels[0]}) — ${fieldCount} champ${fieldCount > 1 ? 's' : ''}.`;
    this.logger.log(message);

    return {
      data: merged as T,
      meta: {
        modelUsed: contributingModels[0],
        fallbackUsed: attempts.some((a) => !a.success),
        attempts,
        message,
        hasUsableData: fieldCount > 0,
      },
    };
  }

  /** Settings → AI "Tester la connexion" — exactly one minimal request against the FIRST configured model only (not the whole failover list), real error surfaced. */
  async testConnection(organizationId?: string): Promise<{ success: boolean; message: string }> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      return { success: false, message: 'Aucune clé API OpenRouter configurée.' };
    }
    const [model] = this.resolveModels(org);
    try {
      const text = await this.callModel(model!, apiKey, 'Reply with exactly: OK', 'Test.');
      return { success: true, message: `Connexion OpenRouter réussie (modèle : ${model}). Réponse : "${text.trim().slice(0, 60)}"` };
    } catch (e) {
      return { success: false, message: `Échec OpenRouter (modèle : ${model}) : ${describeError(e)}` };
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
    // Search strategy validated by hand against a real, fairly obscure case
    // (a 1979 regional Belgian painting, private collection, no museum
    // record): the artist's own site ("[name].be"/".com", often with an
    // "œuvres"/"catalogue raisonné" page) and auction-house listings
    // (Artnet, Invaluable, auction-house PDF catalogs) reliably carry the
    // exact technique, dimensions, signature placement, and catalogue
    // raisonné number that a plain "describe this painting" prompt has no
    // way to recall from memory alone. Naming these source types and the
    // "catalogue raisonné" keyword explicitly — both in the system prompt
    // and in the search query itself — is what actually surfaces them.
    const systemPrompt = `You are an expert art cataloguer with access to real-time web search results for this query.
Respond in language code: ${input.locale}.
The most reliable sources for a specific, named work are: (1) the artist's own official website, which for many painters has a dedicated "œuvres"/"catalogue raisonné"/"works" page listing each piece with its number, technique, and dimensions; (2) auction house listings and lot PDFs (Artnet, Invaluable, regional auction houses), which routinely state the exact technique/medium, dimensions in cm, where and how the work is signed, and sometimes a catalogue raisonné number; (3) museum/gallery pages. Prefer these over your own memory — for a regional or private-collection work you likely have no reliable memory of it at all, and a generic guess (e.g. "female nude") is worse than leaving a field empty.
If a catalogue raisonné number or its author is found, append it to the description as "Catalogue raisonné n° X (établi par Y)".
If a real, working image URL for this exact work is found in a search result (e.g. an auction lot photo, the artist's own site, a museum page) — not a generic stock photo or a different work — include it as imageUrl. Never invent or guess a URL you didn't actually see in a source.
If a dimension is found (e.g. "46x38 cm", "46 x 38", "18 x 15 in"), you MUST split it into separate numeric fields: heightCm = the FIRST number, widthCm = the SECOND number, both converted to centimeters (1 in = 2.54 cm) — never leave the parsed numbers out just because you also filled dimensionsNote. dimensionsNote keeps the original raw text (and anything extra, like a frame size) alongside the parsed numbers, it does not replace them.
Only state facts you are actually confident about for this specific, named work — leave a field out entirely rather than guessing or inventing a number you didn't see in a source.
CRITICAL: if the search results contain nothing useful for a field, OMIT that key from the JSON entirely. Never write a sentence ABOUT not finding something (e.g. "The artwork was not found in the search results", "Aucune information disponible pour ce titre") as the VALUE of a field — that is not a real description and must never appear in description, techniqueName, dateText, dimensionsNote, or signatureDescription. An omitted key is the correct way to say "I found nothing".
Return ONLY a JSON object with any of: description, techniqueName, dateText, yearFrom (number), heightCm (number), widthCm (number), dimensionsNote (e.g. "46x38 cm"), signatureDescription (e.g. "signé en bas à droite"), condition, tags (string array), imageUrl.`;
    const userMessage =
      `Artist: ${input.artistName ?? '(unknown)'}\n` +
      `Title: ${input.title ?? '(unknown)'}\n` +
      `Search query to run: ${input.artistName ?? ''} "${input.title ?? ''}" catalogue raisonné dimensions technique signature photo`.trim() +
      (input.searchContext ? `\n\n${input.searchContext}` : '');
    const useWebPlugin = await this.resolveUseWebPlugin(input.organizationId);
    return this.completeMultiModel<ArtworkAutofillResult>(input.organizationId, systemPrompt, userMessage, { webSearch: useWebPlugin });
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    const systemPrompt = `You are an art historian with access to real-time web search results for this query.
Respond in language code: ${input.locale}.
Search results may include Wikipedia, museum biographies, auction house artist pages, or the artist's official site — use them to ground your answer in actual sourced facts rather than a generic guess.
If a real photo/portrait of this specific person is found in a search result, include it as imageUrl — never invent or guess a URL you didn't actually see in a source.
Only state facts you are actually confident about for this specific person — leave a field out entirely rather than guessing.
CRITICAL: if the search results contain nothing useful, OMIT the key entirely. Never write a sentence ABOUT not finding something (e.g. "No information was found for this person") as the VALUE of biography or any other field — an omitted key is the correct way to say "I found nothing".
Return ONLY a JSON object with any of: biography, nationality, birthDate, deathDate, movement, imageUrl.`;
    const userMessage =
      `Artist: ${input.fullName}\nSearch query to run: ${input.fullName} biography portrait photo` +
      (input.searchContext ? `\n\n${input.searchContext}` : '');
    const useWebPlugin = await this.resolveUseWebPlugin(input.organizationId);
    return this.completeMultiModel<ArtistAutofillResult>(input.organizationId, systemPrompt, userMessage, { webSearch: useWebPlugin });
  }

  /** OFF by default — see OrgAiSettings.useOpenRouterWebPlugin. Free grounding instead comes from the caller's searchContext (common/free-web-search.util.ts), appended directly into the user message above. */
  private async resolveUseWebPlugin(organizationId?: string): Promise<boolean> {
    const org = await this.resolveOrgSettings(organizationId);
    return org?.useOpenRouterWebPlugin === true;
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

  /** Dedicated multi-image search — same web-search grounding as autofill, but asks specifically for every real candidate found instead of one best-effort URL. */
  async findImages(input: FindImagesInput): Promise<AiAutofillResponse<FindImagesResult>> {
    const systemPrompt = `You have access to real-time web search results for this query.
Find as many DIFFERENT real, working image URLs as you can (up to 6) showing the exact subject of this query — actual photos found in search results (an auction lot photo, a museum/gallery page, the subject's own official website), never a generic stock photo, never a different work/person, and never an invented or guessed URL.
CRITICAL: if nothing useful is found, OMIT the key entirely. Never write a sentence about not finding anything as a value.
Return ONLY a JSON object: {"imageUrls": ["...", ...]}`;
    const userMessage = input.query + (input.searchContext ? `\n\n${input.searchContext}` : '');
    const useWebPlugin = await this.resolveUseWebPlugin(input.organizationId);
    return this.completeMultiModel<FindImagesResult>(input.organizationId, systemPrompt, userMessage, { webSearch: useWebPlugin });
  }

  // The other AI capabilities are not implemented for OpenRouter.
  async ocr(_imageUrl: string): Promise<string> {
    throw new ServiceUnavailableException('OCR not supported by OpenRouter provider');
  }

  async tags(_input: DescribeInput): Promise<string[]> {
    throw new ServiceUnavailableException('Tagging not supported by OpenRouter provider');
  }
}
