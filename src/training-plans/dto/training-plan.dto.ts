import {
  IsString, IsNumber, IsBoolean, IsOptional, IsEnum,
  IsUrl, IsIn, Min, Max, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrainingCategory } from '@prisma/client';

export enum SessionType {
  Mobility = 'Mobility',
  LPO = 'LPO',
  Strength = 'Strength',
  Gymnastics = 'Gymnastics',
  Metcon = 'Metcon',
  Endurance = 'Endurance',
  Core = 'Core',
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export class CreatePlanDto {
  @ApiProperty({ description: 'ID do aluno' })
  @IsString()
  studentId: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  month: number;

  @ApiProperty({ example: '2026-03-09', description: 'Data de início real (Segunda-feira da Semana 1) — string YYYY-MM-DD, normalizada no backend' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: 'Mês 1 — Programação Gustavo' })
  @IsString()
  title: string;
}

/** Categorias que aceitam plano compartilhado; PERFORMANCE é sempre individual. */
export const SHARED_CATEGORIES = [TrainingCategory.CORE, TrainingCategory.LPO] as const;

export class CreateSharedPlanDto {
  @ApiProperty({ enum: SHARED_CATEGORIES })
  @IsIn(SHARED_CATEGORIES as unknown as string[])
  category: (typeof SHARED_CATEGORIES)[number];

  @ApiProperty({ example: 1 })
  @IsNumber()
  month: number;

  @ApiProperty({ example: '2026-03-09', description: 'Segunda-feira da Semana 1 (calendário do plano, igual pra todos os alunos) — YYYY-MM-DD' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: 'Core — Março' })
  @IsString()
  title: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  published?: boolean;
}

// ── Week ─────────────────────────────────────────────────────────────────────

export class CreateWeekDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  weekNumber: number;
}

// ── Day ──────────────────────────────────────────────────────────────────────

export class CreateDayDto {
  @ApiProperty({ example: 'Terça' })
  @IsString()
  dayOfWeek: string;

  @ApiProperty({ example: 2, description: '0 = Dom, 1 = Seg, ..., 6 = Sáb' })
  @IsNumber()
  @Min(0)
  @Max(6)
  dayIndex: number;
}

// ── Session ──────────────────────────────────────────────────────────────────

export class CreateSessionDto {
  @ApiProperty({ example: 'Sessão 1 — LPO (Snatch)' })
  @IsString()
  name: string;

  @ApiProperty({ enum: SessionType })
  @IsEnum(SessionType)
  type: SessionType;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

// ── Exercise ─────────────────────────────────────────────────────────────────

export class CreateExerciseDto {
  @ApiProperty({ example: 'Snatch Complex' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/...' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsOptional()
  youtubeUrl?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsNumber()
  @IsOptional()
  sets?: number;

  @ApiPropertyOptional({ example: '3 reps' })
  @IsString()
  @IsOptional()
  reps?: string;

  @ApiPropertyOptional({ example: '45 segundos' })
  @IsString()
  @IsOptional()
  duration?: string;

  @ApiPropertyOptional({ example: 90 })
  @IsNumber()
  @IsOptional()
  restSeconds?: number;

  @ApiPropertyOptional({ example: 75 })
  @IsNumber()
  @IsOptional()
  loadPercent?: number;

  @ApiPropertyOptional({ example: 'Mantenha o core ativo' })
  @IsString()
  @IsOptional()
  coachNotes?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

export class UpdateExerciseDto extends CreateExerciseDto {}
