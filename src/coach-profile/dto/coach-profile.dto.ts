import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Card do bloco "Como funciona o acompanhamento". Vazio = texto padrão daquela posição (o front mantém a ordem). */
export class PillarDto {
  @ApiProperty() @IsString() @MaxLength(60) title!: string;
  @ApiProperty() @IsString() @MaxLength(200) text!: string;
}

/** Textos editáveis da landing (todos opcionais — ausente = padrão do template). */
export class PageCopyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) howItWorksTitle?: string;

  @ApiPropertyOptional({ type: [PillarDto], maxItems: 4 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PillarDto)
  pillars?: PillarDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) plansTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) finalTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) finalCtaLabel?: string;
}

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

  @ApiPropertyOptional({ description: 'Frase de destaque do hero. Sem valor, usa o texto padrão do template.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headline?: string;

  @ApiPropertyOptional({ description: 'Parágrafo de apoio abaixo do headline.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subheadline?: string;

  @ApiPropertyOptional({ description: 'Citação em destaque na seção "Sobre o coach"' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  quote?: string;

  @ApiPropertyOptional({ description: 'Selo curto de credencial, ex.: "Semifinals CrossFit Games"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  achievementBadge?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsExperience?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  athletesCount?: number;

  @ApiPropertyOptional({ description: 'Métrica autodeclarada (0-100), exibida na seção de depoimentos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  npsScore?: number;

  @ApiPropertyOptional({ description: 'Percentual de conclusão de ciclo autodeclarado (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  completionRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsappNumber?: string;

  @ApiPropertyOptional({ description: 'Link do vídeo de demonstração (YouTube)' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  videoUrl?: string;

  @ApiPropertyOptional({ description: 'Dias de garantia oferecidos pelo coach (além do arrependimento legal de 7 dias)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  guaranteeDays?: number;

  @ApiPropertyOptional({ description: 'Como funciona a garantia (ex.: "devolvo 100% se não gostar")' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  guaranteeText?: string;

  @ApiPropertyOptional({ description: 'E-mail de suporte ao aluno' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  supportEmail?: string;

  @ApiPropertyOptional({ description: 'Horário de atendimento (ex.: "Seg a sex, 8h às 18h")' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supportHours?: string;

  @ApiPropertyOptional({ type: PageCopyDto, description: 'Textos editáveis da página; campo ausente usa o texto padrão' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PageCopyDto)
  pageCopy?: PageCopyDto;
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

export class UpsertTestimonialDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  authorName!: string;

  @ApiPropertyOptional({ description: 'Ex.: "Atleta de CrossFit RX"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  authorRole?: string;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  content!: string;

  @ApiPropertyOptional({ description: 'Ordem de exibição — menor primeiro' })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpsertFaqItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  question!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  answer!: string;

  @ApiPropertyOptional({ description: 'Ordem de exibição — menor primeiro' })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
