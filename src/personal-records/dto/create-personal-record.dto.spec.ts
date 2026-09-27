import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePersonalRecordDto } from './create-personal-record.dto';

const check = (body: object) => validate(plainToInstance(CreatePersonalRecordDto, body));
const movementId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('CreatePersonalRecordDto', () => {
  it('aceita so loadKg, so reps, os dois, e com note', async () => {
    expect(await check({ movementId, loadKg: 100 })).toHaveLength(0);
    expect(await check({ movementId, reps: 10 })).toHaveLength(0);
    expect(await check({ movementId, loadKg: 100, reps: 10 })).toHaveLength(0);
    expect(await check({ movementId, loadKg: 100, note: 'Boa execução' })).toHaveLength(0);
  });

  it('rejeita movementId ausente ou fora do formato UUID', async () => {
    expect((await check({ loadKg: 100 })).some(e => e.property === 'movementId')).toBe(true);
    expect((await check({ movementId: 'nao-e-uuid', loadKg: 100 })).some(e => e.property === 'movementId')).toBe(true);
  });

  it('rejeita loadKg e reps não positivos', async () => {
    expect((await check({ movementId, loadKg: -10 })).some(e => e.property === 'loadKg')).toBe(true);
    expect((await check({ movementId, loadKg: 0 })).some(e => e.property === 'loadKg')).toBe(true);
    expect((await check({ movementId, reps: -1 })).some(e => e.property === 'reps')).toBe(true);
    expect((await check({ movementId, reps: 0 })).some(e => e.property === 'reps')).toBe(true);
  });

  it('rejeita reps não inteiro e note maior que 500 caracteres', async () => {
    expect((await check({ movementId, reps: 10.5 })).some(e => e.property === 'reps')).toBe(true);
    expect((await check({ movementId, loadKg: 100, note: 'x'.repeat(501) })).some(e => e.property === 'note')).toBe(true);
  });
});
