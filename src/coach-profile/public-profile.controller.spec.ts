import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PublicProfileController } from './public-profile.controller';
import { CoachProfileService } from './coach-profile.service';

function build() {
  const service = { getPublicBySlug: jest.fn(), createLead: jest.fn() };
  const controller = new PublicProfileController(service as unknown as CoachProfileService);
  return { controller, service };
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
