import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Inscrição do visitante na landing do coach: vira conta de aluno já vinculada a esse coach. SEM senha (decisão do dono,
 * 2026-09-30): a senha é criada no link de confirmação — quem não recebe o e-mail nunca chega a ter senha na conta.
 */
export class PublicSignupDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ description: 'Plano escolhido na página (tem de ser do mesmo coach e estar ativo)' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ description: 'Aceite dos Termos de Uso e da Política de Privacidade — obrigatório' })
  @Equals(true, { message: 'É preciso aceitar os Termos de Uso e a Política de Privacidade.' })
  acceptTerms!: boolean;

  @ApiProperty({
    required: false,
    description:
      'Consentimento para dados de saúde (LGPD Art. 11) — opcional, caixa própria e desmarcada; ausente = não',
  })
  @IsOptional()
  @IsBoolean()
  healthConsent?: boolean;
}
