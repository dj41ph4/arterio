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
  ChatMessage,
  ChatToolCall,
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
  mistralApiKeyEnc?: string;
}

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
    const detail = err.message.replace(/^HTTP \d+\s*/, '').replace(/^—\s*/, '');
    if (err.message.includes('401')) return `Clé API Mistral invalide ou refusée (401)${detail ? ` — ${detail}` : ''}`;
    if (err.message.includes('422')) return `Requête invalide auprès de Mistral (422)${detail ? ` — ${detail}` : ''}`;
    if (err.message.includes('429')) return `Limite de requêtes Mistral atteinte (429)${detail ? ` — ${detail}` : ''}`;
    if (/^HTTP \d+/.test(err.message)) return err.message.replace(/^HTTP (\d+)/, 'Le serveur Mistral a répondu avec une erreur ($1)');
    return err.message;
  }
  return String(err);
}

/**
 * Mistral (La Plateforme) provider — native web_search grounding via the
 * Conversations API (`/v1/conversations`), Mistral's only endpoint that
 * supports the `web_search` built-in connector (it's explicitly unsupported
 * on `/v1/chat/completions`, which has no way to attach search results).
 * That API is agent-based: a lightweight "agent" (model + tools config) must
 * exist before a conversation can reference it, so one agent is created
 * lazily per API key and reused for the life of the process — re-creating
 * one per call would be a wasted extra round-trip every time. Per-call task
 * instructions (which vary: artwork autofill vs. artist autofill vs. image
 * search) are sent as the conversation's `inputs` text rather than baked
 * into the agent, since the agent itself is shared across every call.
 */
export class MistralAiProvider implements AiProvider {
  readonly id = 'mistral';
  readonly enabled = true;
  private readonly logger = new Logger(MistralAiProvider.name);

  private readonly envApiKey: string;
  private readonly model: string;
  private readonly ocrModel: string;
  private readonly visionModel: string;
  /** One websearch-enabled agent id per API key, created on first use and kept for the process lifetime. */
  private readonly agentIdByKey = new Map<string, Promise<string>>();

  constructor(
    envApiKey: string,
    model: string,
    private readonly prisma?: PrismaService,
    private readonly crypto?: CryptoService,
    opts?: { ocrModel?: string; visionModel?: string },
  ) {
    this.envApiKey = envApiKey;
    this.model = model || 'mistral-medium-latest';
    this.ocrModel = opts?.ocrModel || 'mistral-ocr-latest';
    this.visionModel = opts?.visionModel || 'pixtral-12b-2409';
  }

  private async resolveOrgSettings(organizationId?: string): Promise<OrgAiSettings | null> {
    if (!organizationId || !this.prisma) return null;
    try {
      const org = await getCachedOrg(organizationId, () => this.prisma!.organization.findUnique({ where: { id: organizationId } }));
      return ((org?.settings as Record<string, unknown>)?.ai as OrgAiSettings | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private async resolveApiKey(org: OrgAiSettings | null): Promise<string> {
    if (org?.mistralApiKeyEnc && this.crypto) {
      try {
        return this.crypto.decrypt(org.mistralApiKeyEnc);
      } catch {
        // fall through to env key
      }
    }
    return this.envApiKey;
  }

  async isEnabled(organizationId?: string): Promise<boolean> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    return Boolean(apiKey);
  }

  capabilities(): AiCapabilities {
    return { describe: true, tag: false, ocr: true, signature: false, compare: false, similar: false, classify: false, chat: true, vision: true };
  }

  /**
   * Serializes calls per process with ≥1100 ms spacing — the free tier allows
   * ~1 req/s and the chat tool loop makes 2-4 sequential calls per question, so
   * two overlapping questions (or the assistant plus a background autofill)
   * would otherwise trade 429s. One retry after a 429 absorbs transient bursts.
   */
  private paceTail: Promise<void> = Promise.resolve();
  private paced<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.paceTail.then(async () => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof Error && e.message.includes('429')) {
          await new Promise((r) => setTimeout(r, 2500));
          return fn();
        }
        throw e;
      }
    });
    this.paceTail = run.then(
      () => new Promise((r) => setTimeout(r, 1100)),
      () => new Promise((r) => setTimeout(r, 1100)),
    );
    return run;
  }

  private async mistralFetch(apiKey: string, path: string, body: unknown): Promise<any> {
    const res = await fetch(`https://api.mistral.ai/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(errorBody) as { message?: string; error?: { message?: string } };
        detail = parsed.message ?? parsed.error?.message ?? '';
      } catch {
        if (errorBody) detail = errorBody.slice(0, 200);
      }
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    return res.json();
  }

  /** Our provider-agnostic ChatMessage → Mistral/OpenAI wire shape. */
  private toWireMessages(systemPrompt: string, messages: ChatMessage[]): unknown[] {
    const wire: unknown[] = [{ role: 'system', content: systemPrompt }];
    for (const m of messages) {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        wire.push({
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.argumentsJson },
          })),
        });
      } else if (m.role === 'tool') {
        wire.push({ role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content });
      } else {
        wire.push({ role: m.role, content: m.content });
      }
    }
    return wire;
  }

  /** ONE tool-calling turn on /chat/completions — the loop (execute tools, re-call) lives in ChatService. */
  async chat(input: AiChatInput): Promise<AiChatTurn> {
    const org = await this.resolveOrgSettings(input.organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      throw new ServiceUnavailableException("Aucune clé API Mistral configurée — impossible d'appeler Mistral.");
    }
    const attempts: AiAttemptLog[] = [];
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: this.toWireMessages(input.systemPrompt, input.messages),
        temperature: 0.2,
      };
      if (input.tools.length) {
        body.tools = input.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = 'auto';
      }
      const data = await this.paced(() => this.mistralFetch(apiKey, '/chat/completions', body));
      const message = data?.choices?.[0]?.message;
      if (!message) throw new Error('Réponse reçue mais format inattendu (choices[0].message manquant)');

      const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const toolCalls: ChatToolCall[] = rawCalls
        .filter((c: any) => c?.function?.name)
        .map((c: any, i: number) => ({
          id: String(c.id ?? `call_${i}`),
          name: String(c.function.name),
          argumentsJson: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
        }));

      const text = typeof message.content === 'string' ? message.content : undefined;
      const ok = Boolean(toolCalls.length || (text && text.trim()));
      const msg = ok
        ? `Tour de chat Mistral réussi (modèle : ${this.model}${toolCalls.length ? `, ${toolCalls.length} appel(s) d'outil` : ''}).`
        : `Réponse Mistral vide (modèle : ${this.model}).`;
      attempts.push({ model: this.model, success: ok, message: msg, provider: 'mistral' });
      return {
        text: toolCalls.length ? undefined : text?.trim(),
        toolCalls: toolCalls.length ? toolCalls : undefined,
        meta: { modelUsed: this.model, fallbackUsed: false, attempts, message: msg, hasUsableData: ok },
      };
    } catch (e) {
      const message = `Échec du chat Mistral ("${this.model}") : ${describeError(e)}`;
      this.logger.warn(message);
      attempts.push({ model: this.model, success: false, message, provider: 'mistral' });
      throw new ServiceUnavailableException(message);
    }
  }

  /** Vision analysis (condition reports): image as a data-URL content part on the vision model, JSON out. */
  async analyzeImage(input: AiVisionInput): Promise<AiVisionResult> {
    const org = await this.resolveOrgSettings(input.organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      throw new ServiceUnavailableException("Aucune clé API Mistral configurée — impossible d'appeler Mistral.");
    }
    const attempts: AiAttemptLog[] = [];
    try {
      const data = await this.paced(() =>
        this.mistralFetch(apiKey, '/chat/completions', {
          model: this.visionModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `${input.task}\nRespond in language code: ${input.locale}. Return ONLY a JSON object.` },
                { type: 'image_url', image_url: `data:${input.mimeType};base64,${input.imageBase64}` },
              ],
            },
          ],
          temperature: 0.1,
        }),
      );
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('Réponse vision vide.');
      const block = extractJsonBlock(text);
      if (!block) throw new Error('Réponse vision sans JSON exploitable.');
      const json = JSON.parse(block) as Record<string, unknown>;
      const message = `Analyse d'image réussie (modèle : ${this.visionModel}).`;
      attempts.push({ model: this.visionModel, success: true, message, provider: 'mistral' });
      return { json, meta: { modelUsed: this.visionModel, fallbackUsed: false, attempts, message, hasUsableData: true } };
    } catch (e) {
      const message = `Échec de l'analyse d'image Mistral ("${this.visionModel}") : ${describeError(e)}`;
      this.logger.warn(message);
      attempts.push({ model: this.visionModel, success: false, message, provider: 'mistral' });
      throw new ServiceUnavailableException(message);
    }
  }

  /** Creates (once) the shared websearch agent for this API key, or returns the cached id. */
  private getOrCreateAgent(apiKey: string): Promise<string> {
    const cached = this.agentIdByKey.get(apiKey);
    if (cached) return cached;
    const created = this.mistralFetch(apiKey, '/agents', {
      model: this.model,
      name: 'Arterio Websearch Agent',
      description: 'Finds real, sourced facts on the web for art-catalogue autofill.',
      instructions: 'You have the ability to perform web searches with web_search to find up-to-date, sourced information. Always prefer real search results over your own memory.',
      tools: [{ type: 'web_search' }],
      completion_args: { temperature: 0 },
    }).then((data) => {
      const agentId = data?.id;
      if (!agentId) throw new Error('Réponse de création d\'agent Mistral sans id exploitable.');
      return agentId as string;
    });
    // Don't cache a rejected creation — a transient failure shouldn't permanently poison every future call.
    created.catch(() => this.agentIdByKey.delete(apiKey));
    this.agentIdByKey.set(apiKey, created);
    return created;
  }

  /** Extracts the assistant's plain text from a Conversations API response — its `outputs` is a list of entries (tool execution traces + the final message), and a message's `content` may itself be a string or a list of {type:'text', text} / tool_reference chunks. */
  private extractConversationText(data: any): string {
    const outputs: any[] = data?.outputs ?? (data?.message ? [data.message] : []);
    const messageEntries = outputs.filter((o) => o?.type === 'message.output' || o?.role === 'assistant' || o?.content !== undefined);
    const texts: string[] = [];
    for (const entry of messageEntries.length ? messageEntries : outputs) {
      const content = entry?.content;
      if (typeof content === 'string') {
        texts.push(content);
      } else if (Array.isArray(content)) {
        for (const chunk of content) {
          if (typeof chunk === 'string') texts.push(chunk);
          else if (chunk?.type === 'text' && typeof chunk?.text === 'string') texts.push(chunk.text);
        }
      }
    }
    return texts.join('\n');
  }

  private async callModel(apiKey: string, systemPrompt: string, userMessage: string, webSearch: boolean): Promise<string> {
    if (!webSearch) {
      const data = await this.mistralFetch(apiKey, '/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
      });
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Réponse reçue mais format inattendu (choices[0].message.content manquant)');
      return text;
    }

    const agentId = await this.getOrCreateAgent(apiKey);
    const data = await this.mistralFetch(apiKey, '/conversations', {
      agent_id: agentId,
      inputs: `${systemPrompt}\n\n${userMessage}`,
    });
    const text = this.extractConversationText(data);
    if (!text) throw new Error('Réponse reçue mais aucun texte exploitable dans la conversation Mistral.');
    return text;
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
      const message = "Aucune clé API Mistral configurée — impossible d'appeler Mistral.";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    const attempts: AiAttemptLog[] = [];
    try {
      const text = await this.callModel(apiKey, systemPrompt, userMessage, webSearch);
      const block = extractJsonBlock(text);
      if (!block) {
        attempts.push({ model: this.model, success: false, message: `Réponse reçue de Mistral ("${this.model}") mais aucun JSON exploitable.`, provider: 'mistral' });
        return { data: {} as T, meta: { fallbackUsed: false, attempts, message: attempts[0]!.message, hasUsableData: false } };
      }
      const parsed = stripFillerFields(JSON.parse(block) as Record<string, unknown>);
      const fieldCount = Object.values(parsed).filter(
        (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0),
      ).length;
      const message =
        fieldCount > 0
          ? `Réponse reçue avec succès de Mistral (modèle : ${this.model}, ${fieldCount} champ${fieldCount > 1 ? 's' : ''}).`
          : `Réponse reçue de Mistral ("${this.model}") mais sans information exploitable.`;
      attempts.push({ model: this.model, success: fieldCount > 0, message, provider: 'mistral' });
      return { data: parsed as T, meta: { modelUsed: this.model, fallbackUsed: false, attempts, message, hasUsableData: fieldCount > 0 } };
    } catch (e) {
      const reason = describeError(e);
      const message = `Échec appel Mistral ("${this.model}") : ${reason}`;
      this.logger.warn(message);
      attempts.push({ model: this.model, success: false, message, provider: 'mistral' });
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
    // Rescue path: when the free DDG/Wikidata/Wikipedia context came back empty,
    // fall back to Mistral's own (paid) native web_search so the model still has
    // real grounding instead of returning {}. Only fires when the free path found
    // nothing — no extra cost on the common case where DDG already delivered.
    const webSearch = !input.searchContext;
    return this.completeJson<ArtworkAutofillResult>(input.organizationId, systemPrompt, userMessage, webSearch);
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    const systemPrompt = `You are an art database assistant. Respond in language code: ${input.locale}.
STRICT SOURCING RULE: use ONLY facts explicitly stated in the search results provided. Do NOT draw on your training-data knowledge of this artist — training data about lesser-known or regional artists is frequently wrong, confused with other artists of similar names, or entirely fabricated. If a fact is not clearly present in the search results, omit that field entirely.
Any block marked "[WIKIDATA VERIFIED]" in the search results is authoritative: treat its birthDate/deathDate/nationality/movement as explicitly stated and use them directly — do NOT require a second source to confirm them. Likewise, a Wikipedia extract in the results IS a valid source for the biography — summarise it faithfully in the requested language.
If the search results are absent or contain nothing useful about this specific person, return an empty JSON object {}.
If a real portrait URL is found in the search results, include it as imageUrl — never invent or guess a URL.
Never invent dates, nationalities, schools, or biographies — a missing field is always better than a wrong one.
Return ONLY a JSON object with any subset of: biography, nationality, birthDate, deathDate, movement, imageUrl.`;
    const userMessage = `Artist: ${input.fullName}` +
      (input.searchContext ? `\n\n${input.searchContext}` : '');
    // Rescue path — see autofillArtwork: native web_search only when the free
    // DDG/Wikidata/Wikipedia context found nothing about this person.
    const webSearch = !input.searchContext;
    return this.completeJson<ArtistAutofillResult>(input.organizationId, systemPrompt, userMessage, webSearch);
  }

  async findImages(input: FindImagesInput): Promise<AiAutofillResponse<FindImagesResult>> {
    const systemPrompt = `Extract real, working image URLs from the search results provided below.
Find as many DIFFERENT image URLs as you can (up to 6) showing the exact subject of this query — actual photos found in the results, never a generic stock photo, never invented.
CRITICAL: if nothing useful is found, OMIT the key entirely.
Return ONLY a JSON object: {"imageUrls": ["...", ...]}`;
    const userMessage = input.query + (input.searchContext ? `\n\n${input.searchContext}` : '');
    return this.completeJson<FindImagesResult>(input.organizationId, systemPrompt, userMessage, false);
  }

  /** Best-effort text translation — never throws, returns null so the caller (enrichment) just skips that locale on failure. No web search needed, so this uses the plain chat completions endpoint, not the agent/conversation flow. */
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
      this.logger.warn(`Traduction Mistral vers "${input.targetLocale}" échouée : ${describeError(e)}`);
      return null;
    }
  }

  /** Settings → AI "Tester la connexion" — exactly one minimal request, no web search (no agent round-trip), real error surfaced instead of swallowed. */
  async testConnection(organizationId?: string): Promise<{ success: boolean; message: string }> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      return { success: false, message: 'Aucune clé API Mistral configurée.' };
    }
    try {
      const text = await this.callModel(apiKey, 'Reply with exactly: OK', 'Test.', false);
      return { success: true, message: `Connexion Mistral réussie (modèle : ${this.model}). Réponse : "${text.trim().slice(0, 60)}"` };
    } catch (e) {
      return { success: false, message: `Échec Mistral (modèle : ${this.model}) : ${describeError(e)}` };
    }
  }

  /** Mistral's dedicated OCR endpoint — base64 data-URL in, page markdown out; PDFs and images alike. */
  async ocr(input: AiOcrInput): Promise<AiOcrResult> {
    const org = await this.resolveOrgSettings(input.organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) {
      throw new ServiceUnavailableException("Aucune clé API Mistral configurée — impossible d'appeler Mistral.");
    }
    const attempts: AiAttemptLog[] = [];
    const dataUrl = `data:${input.mimeType};base64,${input.base64}`;
    const document =
      input.mimeType === 'application/pdf'
        ? { type: 'document_url', document_url: dataUrl }
        : { type: 'image_url', image_url: dataUrl };
    try {
      const data = await this.paced(() => this.mistralFetch(apiKey, '/ocr', { model: this.ocrModel, document }));
      const text = ((data?.pages ?? []) as Array<{ markdown?: string; text?: string }>)
        .map((p) => p.markdown ?? p.text ?? '')
        .join('\n\n')
        .trim();
      const ok = text.length > 0;
      const message = ok
        ? `OCR réussi (modèle : ${this.ocrModel}, ${text.length} caractères).`
        : `OCR sans texte détecté (modèle : ${this.ocrModel}).`;
      attempts.push({ model: this.ocrModel, success: ok, message, provider: 'mistral' });
      return { text, meta: { modelUsed: this.ocrModel, fallbackUsed: false, attempts, message, hasUsableData: ok } };
    } catch (e) {
      const message = `Échec OCR Mistral ("${this.ocrModel}") : ${describeError(e)}`;
      this.logger.warn(message);
      attempts.push({ model: this.ocrModel, success: false, message, provider: 'mistral' });
      throw new ServiceUnavailableException(message);
    }
  }

  async tags(_input: DescribeInput): Promise<string[]> {
    throw new ServiceUnavailableException('Tagging not supported by Mistral provider');
  }
}
