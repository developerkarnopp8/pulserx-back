import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptCoachTermsDto } from './coach-terms.dto';

describe('AcceptCoachTermsDto', () => {
  it('só aceita acceptTerms === true', async () => {
    const erros = async (body: object) => (await validate(plainToInstance(AcceptCoachTermsDto, body))).length;
    expect(await erros({ acceptTerms: true })).toBe(0);
    for (const body of [{}, { acceptTerms: false }, { acceptTerms: 'true' }, { acceptTerms: 1 }]) {
      expect(await erros(body)).toBe(1);
    }
  });
});
