import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublicSignupDto } from './public-signup.dto';

const base = { name: '  Ana   Souza ', email: ' ana@example.com ', planId: '9ec94a1d-fe52-5cb7-9d77-888c6fedeebc', acceptTerms: true };
const check = (o: object) => validate(plainToInstance(PublicSignupDto, o));

describe('PublicSignupDto', () => {
  it('válido; normaliza espaços do nome e do e-mail', async () => {
    const dto = plainToInstance(PublicSignupDto, base);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('Ana Souza');
    expect(dto.email).toBe('ana@example.com');
  });

  it('sem aceite dos termos: recusado com mensagem clara', async () => {
    const errors = await check({ ...base, acceptTerms: false });
    expect(errors.find(e => e.property === 'acceptTerms')?.constraints?.equals).toContain('aceitar os Termos');
  });

  it('consentimento de saúde é opcional; quando vem, tem de ser booleano', async () => {
    expect(await check({ ...base, healthConsent: true })).toHaveLength(0);
    expect(await check({ ...base, healthConsent: false })).toHaveLength(0);
    expect(
      (await check({ ...base, healthConsent: 'sim' })).map((e) => e.property),
    ).toContain('healthConsent');
  });

  it('recusa e-mail inválido, planId que não é UUID e nome curto', async () => {
    const props = async (o: object) => (await check(o)).map(e => e.property);
    expect(await props({ ...base, email: 'nao-e-email' })).toContain('email');
    expect(await props({ ...base, planId: 'global-snatch' })).toContain('planId');
    expect(await props({ ...base, name: 'A' })).toContain('name');
  });

  it('valor não-texto no nome/e-mail passa pela transformação sem quebrar (e é recusado)', async () => {
    const props = (await check({ ...base, name: 123, email: 456 })).map(e => e.property);
    expect(props).toEqual(expect.arrayContaining(['name', 'email']));
  });

  it('senha na inscrição é recusada (com a mesma regra do ValidationPipe da API): a senha é criada no link do e-mail', async () => {
    const erros = await validate(plainToInstance(PublicSignupDto, { ...base, password: 'senha-do-intruso' }), {
      whitelist: true, forbidNonWhitelisted: true,
    });
    expect(erros.map(e => e.property)).toEqual(['password']);
  });
});
