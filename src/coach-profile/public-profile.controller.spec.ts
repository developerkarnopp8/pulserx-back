import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PublicProfileController } from './public-profile.controller';
import { CoachProfileService } from './coach-profile.service';

function build() {
  const service = { getPublicBySlug: jest.fn(), createLead: jest.fn() };
  const signupService = { signup: jest.fn() };
  const controller = new PublicProfileController(service as unknown as CoachProfileService, signupService as never);
  return { controller, service, signupService };
}

describe('PublicProfileController — sem guard (rota pública)', () => {
  it('não exige nenhum guard (visitante não autenticado precisa acessar)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicProfileController)).toBeUndefined();
  });
});

describe('PublicProfileController — delegação', () => {
  it('getPublic repassa o slug', () => {
    const { controller, service } = build();
    controller.getPublic('luan');
    expect(service.getPublicBySlug).toHaveBeenCalledWith('luan');
  });

  it('createLead repassa slug + dto', () => {
    const { controller, service } = build();
    const dto = { name: 'Ana', email: 'ana@x.com' };
    controller.createLead('luan', dto as never);
    expect(service.createLead).toHaveBeenCalledWith('luan', dto);
  });
});

describe('PublicProfileController — inscrição', () => {
  it('signup repassa slug + dto (o coach vem do slug, nunca do corpo)', () => {
    const { controller, signupService } = build();
    const dto = { name: 'Ana', email: 'ana@example.com', planId: 'p1', acceptTerms: true };
    controller.signup('luan', dto as never);
    expect(signupService.signup).toHaveBeenCalledWith('luan', dto);
  });

  it('signup tem limite próprio de 5/min por IP', () => {
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', PublicProfileController.prototype.signup);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', PublicProfileController.prototype.signup);
    expect([limit, ttl]).toEqual([5, 60_000]);
  });
});

