import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ description: 'invoice | certificate | report | insurance' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Artwork id this document relates to' })
  @IsOptional()
  @IsString()
  artworkId?: string;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Send "" to unlink' })
  @IsOptional()
  @IsString()
  artworkId?: string;
}
