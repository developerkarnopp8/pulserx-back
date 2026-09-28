import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Inscrição do visitante na landing do coach: vira conta de aluno já vinculada a esse coach. */
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

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  @ApiProperty({ description: 'Plano escolhido na página (tem de ser do mesmo coach e estar ativo)' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ description: 'Aceite dos Termos de Uso e da Política de Privacidade — obrigatório' })
  @Equals(true, { message: 'É preciso aceitar os Termos de Uso e a Política de Privacidade.' })
  acceptTerms!: boolean;
}
