import { Transform, Type } from 'class-transformer';
import { WALLET_ID_FORMAT_MESSAGE, WALLET_ID_PATTERN, normalizeWalletId } from '../../common/wallet-id';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength, NotEquals, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus, TrainingCategory } from '@prisma/client';

/** Teto do preço mensal de um plano (R$ 10.000,00) — barra erro de digitação (centavos vs reais). */
export const MAX_PLAN_PRICE_CENTS = 1_000_000;

/** O que o Free libera além das categorias. Só estes campos — `forbidNonWhitelisted` barra o resto. */
export class FreeConfigDto {
  @ApiPropertyOptional({ example: 1, description: 'Sessões-amostra por categoria (0–10)' })
  @IsOptional() @IsInt() @Min(0) @Max(10)
  sampleSessionsPerCategory?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  supportVideos?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  fullHistory?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  chat?: boolean;
}

export class CreateSubscriptionPlanDto {
  @ApiProperty({ example: 'Core' })
  @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @ApiProperty({ example: 14900, description: 'Preço mensal em centavos; 0 = gratuito' })
  @IsInt() @Min(0) @Max(MAX_PLAN_PRICE_CENTS)
  priceCents: number;

  @ApiProperty({ enum: TrainingCategory, isArray: true })
  @IsArray() @ArrayUnique() @ArrayMaxSize(3) @IsEnum(TrainingCategory, { each: true })
  categories: TrainingCategory[];

  @ApiPropertyOptional({ description: 'Plano gratuito (preço sempre 0)' })
  @IsOptional() @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ type: FreeConfigDto })
  @IsOptional() @ValidateNested() @Type(() => FreeConfigDto)
  freeConfig?: FreeConfigDto;

  @ApiPropertyOptional({ description: 'Só planos ativos podem ser atribuídos a novos alunos' })
  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateSubscriptionPlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PLAN_PRICE_CENTS)
  priceCents?: number;

  @ApiPropertyOptional({ enum: TrainingCategory, isArray: true })
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(3) @IsEnum(TrainingCategory, { each: true })
  categories?: TrainingCategory[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ type: FreeConfigDto })
  @IsOptional() @ValidateNested() @Type(() => FreeConfigDto)
  freeConfig?: FreeConfigDto;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;
}

export class AssignSubscriptionDto {
  @ApiProperty({ description: 'Plano de assinatura (do mesmo coach do aluno)' })
  @IsString()
  planId: string;

  @ApiPropertyOptional({ enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  @IsOptional() @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ description: 'Obrigatório e futuro quando status = TRIALING (ISO 8601)' })
  @IsOptional() @IsDateString()
  trialEndsAt?: string;
}

export class UpdateCoachContractDto {
  @ApiProperty({ example: 20, description: 'Porcentagem da plataforma sobre cada cobrança (0–100, até 2 casas)' })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  platformFeePercent: number;
}

export class UpdatePlatformSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enforceSubscriptionAccess: boolean;

  @ApiPropertyOptional({ description: 'Confirma ligar o bloqueio mesmo com alunos sem acesso liberado' })
  @IsOptional() @IsBoolean()
  confirmLockout?: boolean;
}

export class CheckoutSubscriptionDto {
  @ApiProperty({ description: 'Plano de assinatura que o aluno está escolhendo' })
  @IsString()
  planId: string;

  @ApiPropertyOptional({ description: 'CPF do aluno (com ou sem máscara) — obrigatório só se ainda não tiver sido salvo antes' })
  @IsOptional() @IsString() @MinLength(11) @MaxLength(14)
  cpf?: string;
}

export class SetCoachWalletDto {
  @ApiProperty({ description: 'walletId da conta Asaas do coach — onde ele recebe o split de cada cobrança (UUID)' })
  @Transform(({ value }) => normalizeWalletId(value))
  @IsString()
  @Matches(WALLET_ID_PATTERN, { message: WALLET_ID_FORMAT_MESSAGE })
  @NotEquals('00000000-0000-0000-0000-000000000000', { message: WALLET_ID_FORMAT_MESSAGE })
  walletId: string;
}
