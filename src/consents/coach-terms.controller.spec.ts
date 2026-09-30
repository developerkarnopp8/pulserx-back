import { ALLOW_PENDING_TERMS_KEY } from '../auth/decorators/allow-pending-terms.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CoachTermsController } from './coach-terms.controller';

describe('CoachTermsController', () => {
  it('só coach, liberado com o termo pendente, sempre pelo id do token', async () => {
    const consents = {
      getCoachTerms: jest.fn().mockResolvedValue({ accepted: false }),
      acceptCoachTerms: jest.fn().mockResolvedValue({ access_token: 't' }),
    };
    const controller = new CoachTermsController(consents as never);
    await expect(controller.get({ user: { id: 'c1' } })).resolves.toEqual({ accepted: false });
    expect(consents.getCoachTerms).toHaveBeenCalledWith('c1');
    await expect(controller.accept({ acceptTerms: true }, { user: { id: 'c1' } })).resolves.toEqual({ access_token: 't' });
    expect(consents.acceptCoachTerms).toHaveBeenCalledWith('c1');

    expect(Reflect.getMetadata(ROLES_KEY, CoachTermsController)).toEqual(['coach']);
    expect(Reflect.getMetadata(ALLOW_PENDING_TERMS_KEY, CoachTermsController)).toBe(true);
  });
});
