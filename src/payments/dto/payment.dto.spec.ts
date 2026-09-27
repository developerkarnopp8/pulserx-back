import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePaymentDto, UpdatePaymentDto } from './payment.dto';

const check = <T extends object>(cls: new () => T, body: object) => validate(plainToInstance(cls, body));
const base = { studentId: 's1', amount: 149.9, dueDate: '2026-10-05' };

describe('CreatePaymentDto', () => {
  it('aceita o mínimo obrigatório e com description', async () => {
    expect(await check(CreatePaymentDto, base)).toHaveLength(0);
    expect(await check(CreatePaymentDto, { ...base, description: 'Mensalidade' })).toHaveLength(0);
  });

  it('rejeita amount negativo, dueDate inválida e studentId ausente', async () => {
    expect((await check(CreatePaymentDto, { ...base, amount: -1 })).some(e => e.property === 'amount')).toBe(true);
    expect((await check(CreatePaymentDto, { ...base, dueDate: 'não é data' })).some(e => e.property === 'dueDate')).toBe(true);
    expect((await check(CreatePaymentDto, { amount: 10, dueDate: base.dueDate })).some(e => e.property === 'studentId')).toBe(true);
  });
});

describe('UpdatePaymentDto', () => {
  it('tudo opcional; aceita status válido e paidAt', async () => {
    expect(await check(UpdatePaymentDto, {})).toHaveLength(0);
    expect(await check(UpdatePaymentDto, { status: 'paid', paidAt: '2026-10-05' })).toHaveLength(0);
  });

  it('rejeita status fora do enum', async () => {
    expect((await check(UpdatePaymentDto, { status: 'cancelado' })).some(e => e.property === 'status')).toBe(true);
  });
});
