import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExhibitionDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'temporary | permanent | travelling' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  curator?: string;

  @ApiPropertyOptional({ description: 'Artwork ids to include' })
  @IsOptional()
  @IsArray()
  artworkIds?: string[];
}

export class UpdateExhibitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  venue?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  curator?: string;
}
