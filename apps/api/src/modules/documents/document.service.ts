import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UPLOAD_DIR } from '../../core/config/paths';
import { AI_PROVIDER, type AiProvider } from '../ai/ai.types';
import type { AuthUser } from '../../common/types';
import type { CreateDocumentDto, UpdateDocumentDto } from './dto';

const KNOWN_TYPES = ['invoice', 'certificate', 'report', 'insurance'] as const;
type DocType = (typeof KNOWN_TYPES)[number];

function resolveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = Object.values(value as Record<string, unknown>).find((x) => typeof x === 'string' && x);
    return (v as string) ?? '';
  }
  return '';
}

type DocumentRow = {
  id: string;
  title: string;
  type: string;
  artworkId: string | null;
  createdAt: Date;
  ocrText?: string | null;
  extractedFields?: unknown;
  artwork: { title: unknown } | null;
  versions: { sizeBytes: number | null }[];
};

/** Structured fields the AI pulls out of an invoice — applied to the artwork only on explicit user confirmation. */
export interface ExtractedInvoiceFields {
  price?: number;
  currency?: string;
  date?: string;
  seller?: string;
  invoiceNumber?: string;
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async list(user: AuthUser, artworkId?: string) {
    const rows = await this.prisma.document.findMany({
      where: {
        organizationId: user.organizationId,
        ...(artworkId ? { artworkId } : {}),
      },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map((d) => this.toView(d as DocumentRow)) };
  }

  async create(user: AuthUser, dto: CreateDocumentDto) {
    const created = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        type: this.clampType(dto.type),
        artworkId: dto.artworkId || null,
      },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
    });
    return this.toView(created as DocumentRow);
  }

  async update(user: AuthUser, id: string, dto: UpdateDocumentDto) {
    await this.assertExists(user, id);
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: this.clampType(dto.type) }),
        ...(dto.artworkId !== undefined && { artworkId: dto.artworkId || null }),
      },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
    });
    return this.toView(updated as DocumentRow);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.document.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  /** Attaches an uploaded file as the next DocumentVersion. Auto-triggers OCR (fire-and-forget) on invoices. */
  async addVersion(user: AuthUser, id: string, file: { filename: string; mimetype: string; size: number }) {
    const doc = await this.assertExists(user, id);
    const buffer = await readFile(join(UPLOAD_DIR, file.filename));
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const last = await this.prisma.documentVersion.findFirst({ where: { documentId: id }, orderBy: { version: 'desc' } });
    await this.prisma.documentVersion.create({
      data: {
        documentId: id,
        version: (last?.version ?? 0) + 1,
        storageKey: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
        createdById: user.sub,
      },
    });
    // Invoices: OCR + field extraction start immediately (precedent: artist enrichment on create).
    if (doc.type === 'invoice') {
      this.runOcr(user, id).catch((e) => this.logger.warn(`OCR auto (facture ${id}) échoué : ${e instanceof Error ? e.message : String(e)}`));
    }
    return this.getView(user, id);
  }

  /** OCR the latest version, store the searchable text, and — for invoices — extract structured purchase fields. */
  async runOcr(user: AuthUser, id: string) {
    const doc = await this.assertExists(user, id);
    const version = await this.prisma.documentVersion.findFirst({ where: { documentId: id }, orderBy: { version: 'desc' } });
    if (!version) throw new BadRequestException('Ce document n\'a pas encore de fichier.');
    if (!(await this.ai.isEnabled(user.organizationId))) {
      throw new ServiceUnavailableException('Aucun fournisseur IA activé pour cette organisation (Réglages → IA).');
    }

    const buffer = await readFile(join(UPLOAD_DIR, version.storageKey));
    const result = await this.ai.ocr({
      base64: buffer.toString('base64'),
      mimeType: version.mimeType ?? 'application/pdf',
      organizationId: user.organizationId,
    });
    this.logUsage(user.organizationId, 'ocr', result.meta);

    let extractedFields: ExtractedInvoiceFields | null = null;
    if (doc.type === 'invoice' && result.text) {
      extractedFields = await this.extractInvoiceFields(user.organizationId, result.text);
    }

    await this.prisma.document.update({
      where: { id },
      data: {
        ocrText: result.text || null,
        ...(extractedFields ? { extractedFields: extractedFields as never } : {}),
      },
    });
    return this.getView(user, id);
  }

  /** One toolless chat turn turning raw invoice text into { price, currency, date, seller, invoiceNumber } — validated, never trusted. */
  private async extractInvoiceFields(organizationId: string, ocrText: string): Promise<ExtractedInvoiceFields | null> {
    try {
      const turn = await this.ai.chat({
        systemPrompt: `You extract purchase facts from an invoice's OCR text. Return ONLY a JSON object with any subset of:
"price" (number, the total amount), "currency" (ISO code like EUR/USD), "date" (ISO yyyy-mm-dd, the invoice date), "seller" (the selling party's name), "invoiceNumber" (string).
Omit any field you are not sure about. No prose — JSON only.`,
        messages: [{ role: 'user', content: ocrText.slice(0, 6000) }],
        tools: [],
        locale: 'fr',
        organizationId,
      });
      this.logUsage(organizationId, 'invoiceExtract', turn.meta);
      const text = turn.text ?? '';
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) return null;
      const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const out: ExtractedInvoiceFields = {};
      if (typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0) out.price = raw.price;
      if (typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency)) out.currency = raw.currency;
      if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) out.date = raw.date;
      if (typeof raw.seller === 'string' && raw.seller.trim()) out.seller = raw.seller.trim().slice(0, 200);
      if (typeof raw.invoiceNumber === 'string' && raw.invoiceNumber.trim()) out.invoiceNumber = raw.invoiceNumber.trim().slice(0, 80);
      return Object.keys(out).length ? out : null;
    } catch (e) {
      this.logger.warn(`Extraction de facture échouée : ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private logUsage(organizationId: string, operation: string, meta: { attempts: Array<{ model: string; success: boolean; provider?: string }> }): void {
    if (!meta.attempts.length) return;
    this.prisma.aiUsageLog
      .createMany({
        data: meta.attempts.map((a) => ({ organizationId, operation, provider: a.provider ?? 'mistral', model: a.model, success: a.success })),
      })
      .catch(() => undefined);
  }

  private async getView(user: AuthUser, id: string) {
    const row = await this.prisma.document.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
    });
    if (!row) throw new NotFoundException('Document not found');
    return this.toView(row as DocumentRow);
  }

  private clampType(type?: string): DocType {
    return (KNOWN_TYPES as readonly string[]).includes(type ?? '') ? (type as DocType) : 'report';
  }

  private toView(d: DocumentRow) {
    const bytes = d.versions[0]?.sizeBytes ?? 0;
    return {
      id: d.id,
      title: d.title,
      type: this.clampType(d.type),
      artworkId: d.artworkId,
      linkedTo: d.artwork ? resolveText(d.artwork.title) : 'Collection',
      uploadedAt: d.createdAt.toISOString().slice(0, 10),
      sizeKb: Math.round(bytes / 1024),
      hasFile: d.versions.length > 0,
      hasOcr: Boolean(d.ocrText),
      extractedFields: (d.extractedFields as ExtractedInvoiceFields | null) ?? null,
    };
  }
}
