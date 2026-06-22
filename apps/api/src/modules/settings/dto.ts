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
