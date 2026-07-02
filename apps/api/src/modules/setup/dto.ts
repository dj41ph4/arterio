import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CompleteSetupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  organizationName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password!: string;
}
