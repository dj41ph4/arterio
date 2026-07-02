import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListArtistsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  limit?: number;
}

export class CreateArtistDto {
  @IsString()
  @MaxLength(255)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deathDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  movementId?: string;
}

export class UpdateArtistDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortName?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  birthDate?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  deathDate?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  movementId?: string;

  @ApiPropertyOptional({ description: 'Per-locale biography text, e.g. { fr: "...", en: "..." }' })
  @IsOptional()
  @IsObject()
  biography?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Portrait image URL — send "" to clear' })
  @IsOptional()
  @IsString()
  thumbnail?: string;

  @ApiPropertyOptional({
    description:
      'Wipes biography, thumbnail, movement, and external IDs (Wikidata/ULAN/VIAF) — for ' +
      'undoing a wrong automatic match (e.g. a homonym) before re-enriching or editing by hand.',
  })
  @IsOptional()
  @IsBoolean()
  resetEnrichment?: boolean;
}
