import { ALLOW_PENDING_TERMS_KEY } from '../auth/decorators/allow-pending-terms.decorator';
import { ALLOW_UNLINKED_KEY } from '../auth/decorators/allow-unlinked.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AccountController } from './account.controller';

describe('AccountController', () => {
  it('excluir a própria conta: só aluno, liberado sem vínculo e com termos pendentes, pelo id do token', async () => {
    const account = { deleteMine: jest.fn().mockResolvedValue({ deleted: true }) };
    const controller = new AccountController(account as never);
    await expect(controller.deleteMine({ password: 'senha' }, { user: { id: 'u1' } })).resolves.toEqual({ deleted: true });
    expect(account.deleteMine).toHaveBeenCalledWith('u1', 'senha');

    const handler = AccountController.prototype.deleteMine;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['athlete']);
    expect(Reflect.getMetadata(ALLOW_UNLINKED_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PENDING_TERMS_KEY, handler)).toBe(true);
  });
});
