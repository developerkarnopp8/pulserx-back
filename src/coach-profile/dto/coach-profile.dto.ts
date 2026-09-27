import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class UpdateCoachProfileDto {
  @ApiProperty({ description: 'Identificador da URL pública (/c/:slug) — kebab-case, ex.: "luan-treinador"' })
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(SLUG_REGEX, { message: 'slug deve ser kebab-case: só letras minúsculas, números e hífen entre palavras' })
  slug!: string;

  @ApiPropertyOptional({ description: 'Texto de apresentação do coach na landing page' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;
}

export class PublishCoachProfileDto {
  @ApiProperty()
  @IsBoolean()
  published!: boolean;
}

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
