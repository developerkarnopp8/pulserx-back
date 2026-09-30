import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

/** Tela do próximo login: aceite dos termos (obrigatório) + resposta sobre dados de saúde (obrigatório RESPONDER). */
export class AcceptConsentsDto {
  @ApiProperty({
    description: 'Aceite dos Termos de Uso e da Política de Privacidade na versão atual',
  })
  @Equals(true, {
    message: 'É preciso aceitar os Termos de Uso e a Política de Privacidade.',
  })
  acceptTerms!: boolean;

  @ApiProperty({
    description: 'Consentimento para dados de saúde (LGPD Art. 11) — sim ou não, a escolha é livre',
  })
  @IsBoolean({ message: 'Diga se aceita ou não compartilhar dados de saúde.' })
  healthConsent!: boolean;
}

/** Perfil: dar ou retirar o consentimento de saúde a qualquer momento (Art. 8 §5). */
export class HealthConsentDto {
  @ApiProperty()
  @IsBoolean({ message: 'Diga se aceita ou não compartilhar dados de saúde.' })
  healthConsent!: boolean;
}
