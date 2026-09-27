import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMovementDto } from './create-movement.dto';

const check = (body: object) => validate(plainToInstance(CreateMovementDto, body));

describe('CreateMovementDto', () => {
  it('aceita nome + categoria válida', async () => {
    expect(await check({ name: 'Zercher Squat', category: 'Força' })).toHaveLength(0);
  });

  it('rejeita nome vazio, nome longo demais e categoria fora da lista', async () => {
    expect((await check({ name: '', category: 'Força' })).some(e => e.property === 'name')).toBe(true);
    expect((await check({ name: 'x'.repeat(81), category: 'Força' })).some(e => e.property === 'name')).toBe(true);
    expect((await check({ name: 'x', category: 'Categoria Inventada' })).some(e => e.property === 'category')).toBe(true);
  });
});
