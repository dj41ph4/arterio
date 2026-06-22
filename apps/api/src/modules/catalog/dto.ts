import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ARTWORK_STATUS, type ArtworkStatus } from '@arterio/shared';

/** Accept `?status=a,b` or repeated `?status=a&status=b`. */
const toArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value as string[];
  return String(value).split(',').filter(Boolean);
};

export class ListArtworksQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ isArray: true, enum: ARTWORK_STATUS })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  status?: ArtworkStatus[];

  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  collectionId?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  favorite?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
