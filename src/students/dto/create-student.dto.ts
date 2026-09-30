import { IsString, IsOptional, IsNumber, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Sem senha: o aluno cria a própria pelo link "crie sua senha" que chega por e-mail. */
export class CreateStudentDto {
  @ApiProperty({ example: 'Gustavo Karnopp' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'gustavo@email.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Competição CrossFit' })
  @IsString()
  @IsOptional()
  goal?: string;
}

export class UpdateStudentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  goal?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  currentMonth?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  currentWeek?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  completionPercent?: number;
}
