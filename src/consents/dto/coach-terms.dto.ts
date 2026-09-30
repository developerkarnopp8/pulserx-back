import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

/** Aceite do Termo do Coach na versão atual (obrigatório para usar o painel). */
export class AcceptCoachTermsDto {
  @ApiProperty({ description: 'Aceite do Termo do Coach na versão atual' })
  @Equals(true, { message: 'É preciso aceitar o Termo do Coach para usar o painel.' })
  acceptTerms!: boolean;
}
