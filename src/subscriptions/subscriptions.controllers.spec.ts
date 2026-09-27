import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { AdminController } from '../admin/admin.controller';

const rolesOf = (cls: any, method?: string) =>
  Reflect.getMetadata(ROLES_KEY, method ? cls.prototype[method] : cls);

describe('Controllers da R3 — guards e papéis', () => {
  it.each([SubscriptionPlansController, SubscriptionsController, AdminController])('%p exige JWT + RolesGuard', ctrl => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ctrl)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('catálogo de planos: coach e admin, nunca aluno', () => {
    expect(rolesOf(SubscriptionPlansController)).toEqual(['coach', 'admin']);
  });

  it('assinaturas: aluno só lê a própria; atribuir/ler/remover de um aluno é coach/admin', () => {
    expect(rolesOf(SubscriptionsController, 'getMine')).toEqual(['athlete']);
    for (const m of ['getForStudent', 'assign', 'remove']) {
      expect(rolesOf(SubscriptionsController, m)).toEqual(['coach', 'admin']);
    }
  });

  it('contrato (%) e bloqueio da plataforma: só admin (o AdminController inteiro é admin)', () => {
    expect(rolesOf(AdminController)).toEqual(['admin']);
    for (const m of ['getContract', 'setContract', 'getPlatformSettings', 'setPlatformSettings']) {
      expect(typeof AdminController.prototype[m as keyof AdminController]).toBe('function');
      expect(rolesOf(AdminController, m)).toBeUndefined(); // herdam o papel do controller (admin)
    }
  });
});
