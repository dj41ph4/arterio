import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateLoanDto {
  @IsString()
  @MaxLength(255)
  counterparty!: string;

  @ApiPropertyOptional({ description: 'incoming | outgoing' })
  @IsOptional()
  @IsString()
  direction?: string;

  @ApiPropertyOptional({ description: 'Human reference; auto-generated when omitted' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Artwork ids covered by the loan' })
  @IsOptional()
  @IsArray()
  artworkIds?: string[];
}

export class UpdateLoanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  counterparty?: string;

  @ApiPropertyOptional({ description: 'requested | active | returned' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direction?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Send "" to clear' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
