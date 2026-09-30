import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { SkipReason, SkipDecision } from '@prisma/client';

export class CreateWorkoutSkipDto {
  @ApiProperty({ required: false })
  @ValidateIf(o => !o.sessionId)
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({ required: false })
  @ValidateIf(o => !o.exerciseId)
  @IsUUID()
  sessionId?: string;

  // `Withheld` só o sistema grava (ao retirar o consentimento de saúde) — nunca vem do aluno.
  @ApiProperty({ enum: ['NoTime', 'Injury', 'Later', 'Other'] })
  @IsIn(['NoTime', 'Injury', 'Later', 'Other'])
  reason!: Exclude<SkipReason, 'Withheld'>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ enum: SkipDecision })
  @IsEnum(SkipDecision)
  decision!: SkipDecision;
}
