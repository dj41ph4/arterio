import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
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
import type { PrismaService } from '../../core/prisma/prisma.service';

interface OrgAiSettings {
  providerOrder?: string[];
  disabledProviders?: string[];
}

/**
 * Tries each configured provider in order, falling through to the next
 * whenever one comes back with no usable data — covers a 402 (free-tier
 * quota hit), a 429, or genuinely finding nothing, uniformly, without the
 * caller needing to parse status codes out of error messages. The order
 * itself is org-configurable (Settings → AI: "OpenRouter en priorité" vs
 * "Gemini en priorité") via Organization.settings.ai.providerOrder.
 */
export class AiProviderChain implements AiProvider {
  readonly id = 'chain';
  readonly enabled = true;
  private readonly logger = new Logger(AiProviderChain.name);

  constructor(
    private readonly providersById: Record<string, AiProvider>,
    private readonly defaultOrder: string[],
    private readonly prisma?: PrismaService,
  ) {}

  private async resolveOrder(organizationId?: string): Promise<AiProvider[]> {
    let order = this.defaultOrder;
    if (organizationId && this.prisma) {
      try {
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
        const ai = (org?.settings as Record<string, unknown>)?.ai as OrgAiSettings | undefined;
        if (ai?.providerOrder?.length) order = ai.providerOrder;
        if (ai?.disabledProviders?.length) {
          const disabled = new Set(ai.disabledProviders);
          order = order.filter((id) => !disabled.has(id));
        }
      } catch {
        // fall back to default order
      }
    }
    return order.map((id) => this.providersById[id]).filter((p): p is AiProvider => Boolean(p));
  }

  async isEnabled(organizationId?: string): Promise<boolean> {
    const results = await Promise.all(Object.values(this.providersById).map((p) => p.isEnabled(organizationId)));
    return results.some(Boolean);
  }

  capabilities(): AiCapabilities {
    // Union of every provider's capabilities — a caller checking "can anything in this chain do X" gets the right answer.
    const all = Object.values(this.providersById).map((p) => p.capabilities());
    return {
      describe: all.some((c) => c.describe),
      tag: all.some((c) => c.tag),
      ocr: all.some((c) => c.ocr),
      signature: all.some((c) => c.signature),
      compare: all.some((c) => c.compare),
      similar: all.some((c) => c.similar),
      classify: all.some((c) => c.classify),
    };
  }

  /** Runs `fn` against each enabled provider in resolved order, returning the first usable result, with attempts merged across all of them for transparency. */
  private async tryInOrder<T extends object>(
    organizationId: string | undefined,
    fn: (provider: AiProvider) => Promise<AiAutofillResponse<T>>,
  ): Promise<AiAutofillResponse<T>> {
    const ordered = await this.resolveOrder(organizationId);
    const enabled: AiProvider[] = [];
    for (const p of ordered) {
      if (await p.isEnabled(organizationId)) enabled.push(p);
    }
    if (!enabled.length) {
      const message = 'Aucun fournisseur IA activé pour cette organisation (Réglages → IA).';
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    let last: AiAutofillResponse<T> | null = null;
    const allAttempts: AiAutofillResponse<T>['meta']['attempts'] = [];
    for (let i = 0; i < enabled.length; i++) {
      const provider = enabled[i]!;
      try {
        const result = await fn(provider);
        allAttempts.push(...result.meta.attempts);
        if (result.meta.hasUsableData) {
          const fallbackUsed = i > 0;
          const message = fallbackUsed
            ? `${provider.id === 'gemini' ? 'OpenRouter indisponible — bascule sur Gemini réussie.' : 'Fournisseur précédent indisponible — bascule réussie.'} ${result.meta.message}`
            : result.meta.message;
          this.logger.log(message);
          return { data: result.data, meta: { ...result.meta, attempts: allAttempts, fallbackUsed, message } };
        }
        last = { data: result.data, meta: { ...result.meta, attempts: allAttempts } };
      } catch (e) {
        const message = `Échec du fournisseur "${provider.id}" : ${e instanceof Error ? e.message : String(e)}`;
        this.logger.warn(message);
        allAttempts.push({ model: provider.id, success: false, message });
        last = { data: {} as T, meta: { fallbackUsed: i > 0, attempts: allAttempts, message, hasUsableData: false } };
      }
    }
    return last!;
  }

  async autofillArtwork(input: ArtworkAutofillInput): Promise<AiAutofillResponse<ArtworkAutofillResult>> {
    return this.tryInOrder(input.organizationId, (p) => p.autofillArtwork(input));
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    return this.tryInOrder(input.organizationId, (p) => p.autofillArtist(input));
  }

  async findImages(input: FindImagesInput): Promise<AiAutofillResponse<FindImagesResult>> {
    return this.tryInOrder(input.organizationId, (p) => p.findImages(input));
  }

  /** Settings → AI "Tester la connexion" — targets ONE specific provider by id directly, bypassing the fallback order entirely, so the test reflects exactly the key just typed in rather than whichever provider happens to win the chain. */
  async testProvider(providerId: string, organizationId?: string): Promise<{ success: boolean; message: string }> {
    const provider = this.providersById[providerId];
    if (!provider) return { success: false, message: `Fournisseur "${providerId}" inconnu.` };
    if (!provider.testConnection) return { success: false, message: `Le fournisseur "${providerId}" ne supporte pas le test de connexion.` };
    return provider.testConnection(organizationId);
  }

  async translate(input: TranslateInput): Promise<string | null> {
    const ordered = await this.resolveOrder(input.organizationId);
    for (const provider of ordered) {
      if (!(await provider.isEnabled(input.organizationId))) continue;
      const result = await provider.translate(input);
      if (result) return result;
    }
    return null;
  }

  async describe(input: DescribeInput): Promise<DescribeResult> {
    const ordered = await this.resolveOrder(input.organizationId);
    for (const provider of ordered) {
      if (await provider.isEnabled(input.organizationId)) return provider.describe(input);
    }
    throw new ServiceUnavailableException('Aucun fournisseur IA configuré.');
  }

  async ocr(imageUrl: string): Promise<string> {
    for (const provider of Object.values(this.providersById)) {
      if (provider.capabilities().ocr) return provider.ocr(imageUrl);
    }
    throw new ServiceUnavailableException('OCR not supported by any configured AI provider');
  }

  async tags(input: DescribeInput): Promise<string[]> {
    for (const provider of Object.values(this.providersById)) {
      if (provider.capabilities().tag) return provider.tags(input);
    }
    throw new ServiceUnavailableException('Tagging not supported by any configured AI provider');
  }
}
