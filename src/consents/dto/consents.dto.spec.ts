import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptConsentsDto, HealthConsentDto } from './consents.dto';

describe('AcceptConsentsDto', () => {
  const check = (o: object) => validate(plainToInstance(AcceptConsentsDto, o));

  it.each([true, false])('termos aceitos + saúde %s: válido', async (healthConsent) => {
    expect(await check({ acceptTerms: true, healthConsent })).toHaveLength(0);
  });

  it('sem aceitar os termos ou sem responder a saúde: recusado com mensagem clara', async () => {
    const semTermos = await check({ acceptTerms: false, healthConsent: true });
    expect(semTermos[0]!.constraints?.equals).toBe('É preciso aceitar os Termos de Uso e a Política de Privacidade.');
    const semSaude = await check({ acceptTerms: true });
    expect(semSaude[0]!.constraints?.isBoolean).toBe('Diga se aceita ou não compartilhar dados de saúde.');
  });
});

describe('HealthConsentDto', () => {
  it('só booleano', async () => {
    expect(await validate(plainToInstance(HealthConsentDto, { healthConsent: false }))).toHaveLength(0);
    expect(await validate(plainToInstance(HealthConsentDto, { healthConsent: 'não' }))).toHaveLength(1);
  });
});
