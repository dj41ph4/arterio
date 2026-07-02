import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const MEMBER_STATUSES = ['active', 'invited', 'suspended', 'disabled'] as const;

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(255)
  fullName!: string;

  @IsString()
  roleKey!: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roleKey?: string;

  @ApiPropertyOptional({ enum: MEMBER_STATUSES })
  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: (typeof MEMBER_STATUSES)[number];
}
