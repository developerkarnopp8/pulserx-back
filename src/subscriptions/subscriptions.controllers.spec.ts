import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { CoachContractsService } from './coach-contracts.service';
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

  it('assinaturas: aluno só lê/cancela/assina a própria; atribuir/ler/remover de um aluno é coach/admin; carteira é só do coach', () => {
    expect(rolesOf(SubscriptionsController, 'getMine')).toEqual(['athlete']);
    expect(rolesOf(SubscriptionsController, 'cancelMine')).toEqual(['athlete']);
    expect(rolesOf(SubscriptionsController, 'checkout')).toEqual(['athlete']);
    expect(rolesOf(SubscriptionsController, 'getWallet')).toEqual(['coach']);
    expect(rolesOf(SubscriptionsController, 'setWallet')).toEqual(['coach']);
    expect(rolesOf(SubscriptionsController, 'listGatewayPayments')).toEqual(['coach']);
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

describe('SubscriptionsController — delegação', () => {
  function build() {
    const service = {
      getMine: jest.fn(), getForStudent: jest.fn(), assign: jest.fn(), remove: jest.fn(),
      cancelMine: jest.fn(), checkout: jest.fn(), listGatewayPayments: jest.fn(),
    };
    const coachContracts = { getWallet: jest.fn(), setWallet: jest.fn() };
    const controller = new SubscriptionsController(service as unknown as SubscriptionsService, coachContracts as unknown as CoachContractsService);
    return { controller, service, coachContracts };
  }

  it('checkout repassa req.user + dto', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1', role: 'athlete' } };
    const dto = { planId: 'plan-1' };
    controller.checkout(req, dto as never);
    expect(service.checkout).toHaveBeenCalledWith(req.user, dto);
  });

  it('getWallet/setWallet usam o id do próprio coach logado', () => {
    const { controller, coachContracts } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    controller.getWallet(req);
    expect(coachContracts.getWallet).toHaveBeenCalledWith('coach-1');

    controller.setWallet(req, { walletId: 'wallet-1' } as never);
    expect(coachContracts.setWallet).toHaveBeenCalledWith('coach-1', 'wallet-1');
  });

  it('listGatewayPayments usa o id do próprio coach logado', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    controller.listGatewayPayments(req);
    expect(service.listGatewayPayments).toHaveBeenCalledWith('coach-1');
  });

  it('getMine usa req.user (atleta)', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1', role: 'athlete' } };
    controller.getMine(req);
    expect(service.getMine).toHaveBeenCalledWith(req.user);
  });

  it('cancelMine usa req.user (atleta)', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1', role: 'athlete' } };
    controller.cancelMine(req);
    expect(service.cancelMine).toHaveBeenCalledWith(req.user);
  });

  it('getForStudent repassa studentId + req.user', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    controller.getForStudent('student-1', req);
    expect(service.getForStudent).toHaveBeenCalledWith('student-1', req.user);
  });

  it('assign repassa studentId + req.user + dto', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    const dto = { planId: 'plan-1', status: 'ACTIVE' };
    controller.assign('student-1', req, dto as never);
    expect(service.assign).toHaveBeenCalledWith('student-1', req.user, dto);
  });

  it('remove repassa studentId + req.user', () => {
    const { controller, service } = build();
    const req = { user: { id: 'admin-1', role: 'admin' } };
    controller.remove('student-1', req);
    expect(service.remove).toHaveBeenCalledWith('student-1', req.user);
  });
});

describe('SubscriptionPlansController — delegação', () => {
  function build() {
    const service = { list: jest.fn(), create: jest.fn(), update: jest.fn() };
    const controller = new SubscriptionPlansController(service as unknown as SubscriptionPlansService);
    return { controller, service };
  }

  it('list repassa req.user + coachId opcional', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    controller.list(req);
    expect(service.list).toHaveBeenCalledWith(req.user, undefined);

    controller.list({ user: { id: 'admin-1', role: 'admin' } }, 'coach-2');
    expect(service.list).toHaveBeenCalledWith({ id: 'admin-1', role: 'admin' }, 'coach-2');
  });

  it('create repassa req.user + dto + coachId opcional', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    const dto = { name: 'Combo', priceCents: 9990 };
    controller.create(req, dto as never);
    expect(service.create).toHaveBeenCalledWith(req.user, dto, undefined);

    controller.create({ user: { id: 'admin-1', role: 'admin' } }, dto as never, 'coach-2');
    expect(service.create).toHaveBeenCalledWith({ id: 'admin-1', role: 'admin' }, dto, 'coach-2');
  });

  it('update repassa id + req.user + dto', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    const dto = { active: false };
    controller.update('plan-1', req, dto as never);
    expect(service.update).toHaveBeenCalledWith('plan-1', req.user, dto);
  });
});
