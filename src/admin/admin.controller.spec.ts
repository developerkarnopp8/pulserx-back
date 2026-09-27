import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CoachContractsService } from '../subscriptions/coach-contracts.service';
import { PlatformSettingsService } from '../subscriptions/platform-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('AdminController — guards e roles', () => {
  it('aplica JwtAuthGuard e RolesGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminController);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('exige role admin no controller inteiro', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminController);
    expect(roles).toEqual(['admin']);
  });
});

function build() {
  const service = {
    listCoaches: jest.fn(), createCoach: jest.fn(), resetCoachPassword: jest.fn(), toggleCoachAi: jest.fn(),
  };
  const contracts = { get: jest.fn(), setFee: jest.fn() };
  const platformSettings = { get: jest.fn(), setEnforcement: jest.fn() };
  const controller = new AdminController(
    service as unknown as AdminService,
    contracts as unknown as CoachContractsService,
    platformSettings as unknown as PlatformSettingsService,
  );
  return { controller, service, contracts, platformSettings };
}

describe('AdminController — delegação', () => {
  it('listCoaches delega pro service', () => {
    const { controller, service } = build();
    controller.listCoaches();
    expect(service.listCoaches).toHaveBeenCalled();
  });

  it('createCoach repassa o dto', () => {
    const { controller, service } = build();
    const dto = { name: 'Novo Coach', email: 'novo@aevonfit.com' };
    controller.createCoach(dto as never);
    expect(service.createCoach).toHaveBeenCalledWith(dto);
  });

  it('resetPassword repassa o id', () => {
    const { controller, service } = build();
    controller.resetPassword('coach-1');
    expect(service.resetCoachPassword).toHaveBeenCalledWith('coach-1');
  });

  it('toggleAi repassa id + aiImportEnabled do dto', () => {
    const { controller, service } = build();
    controller.toggleAi('coach-1', { aiImportEnabled: false } as never);
    expect(service.toggleCoachAi).toHaveBeenCalledWith('coach-1', false);
  });

  it('getContract/setContract delegam pro CoachContractsService', () => {
    const { controller, contracts } = build();
    controller.getContract('coach-1');
    expect(contracts.get).toHaveBeenCalledWith('coach-1');
    controller.setContract('coach-1', { platformFeePercent: 15 } as never);
    expect(contracts.setFee).toHaveBeenCalledWith('coach-1', 15);
  });

  it('getPlatformSettings delega pro PlatformSettingsService', () => {
    const { controller, platformSettings } = build();
    controller.getPlatformSettings();
    expect(platformSettings.get).toHaveBeenCalled();
  });

  it('setPlatformSettings repassa enforceSubscriptionAccess + confirmLockout (default false)', () => {
    const { controller, platformSettings } = build();
    controller.setPlatformSettings({ enforceSubscriptionAccess: true } as never);
    expect(platformSettings.setEnforcement).toHaveBeenCalledWith(true, false);

    controller.setPlatformSettings({ enforceSubscriptionAccess: true, confirmLockout: true } as never);
    expect(platformSettings.setEnforcement).toHaveBeenCalledWith(true, true);
  });
});
