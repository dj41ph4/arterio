import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { LOCALES } from '@arterio/shared';

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional()
  @IsIn(LOCALES)
  defaultLocale?: string;

  @ApiPropertyOptional({ description: 'Per-channel notification toggles, e.g. { loanDue: true, insuranceExpiring: false }' })
  @IsOptional()
  notifications?: Record<string, boolean>;
}

export class UpdateExternalSourcesDto {
  @ApiPropertyOptional({ description: 'Leave a field out to keep it unchanged, or send "" to clear it' })
  @IsOptional()
  @IsString()
  europeana?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rijksmuseum?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  harvard?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smithsonian?: string;
}

export const WIPE_CATEGORIES = [
  'artworks',
  'artists',
  'collections',
  'exhibitions',
  'loans',
  'locations',
  'documents',
  'restorations',
] as const;
export type WipeCategory = (typeof WIPE_CATEGORIES)[number];

export class WipeDataDto {
  @IsArray()
  @IsIn(WIPE_CATEGORIES, { each: true })
  categories!: WipeCategory[];
}

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ description: 'Turn OpenRouter-backed AI enrichment on/off for this organization' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Leave out to keep unchanged, or send "" to clear (falls back to the server\'s OPENROUTER_API_KEY env var, if set)' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 3, description: 'Up to 3 OpenRouter model IDs, tried in order — the next is used automatically if one fails.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  models?: string[];

  @ApiPropertyOptional({ description: 'Leave out to keep unchanged, or send "" to clear. Format "accessCode:secretCode". Takes priority over Wikimedia Commons for artwork/artist photos when set.' })
  @IsOptional()
  @IsString()
  wikiartApiKey?: string;

  @ApiPropertyOptional({ description: 'Leave out to keep unchanged, or send "" to clear (falls back to the server\'s GEMINI_API_KEY env var, if set)' })
  @IsOptional()
  @IsString()
  geminiApiKey?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Fallback order between configured providers, e.g. ["openrouter", "gemini"] or reversed.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(['openrouter', 'gemini'], { each: true })
  providerOrder?: string[];
}

export class UploadCertificateDto {
  @ApiPropertyOptional({ description: 'PEM-encoded certificate (and intermediate chain, if any)' })
  @IsString()
  certificate!: string;

  @ApiPropertyOptional({ description: 'PEM-encoded private key, unencrypted' })
  @IsString()
  privateKey!: string;
}

export class UpdateOAuthProviderDto {
  @ApiPropertyOptional({ description: 'Leave out to keep unchanged, or send "" to clear' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Leave out to keep unchanged, or send "" to clear' })
  @IsOptional()
  @IsString()
  clientSecret?: string;
}

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
