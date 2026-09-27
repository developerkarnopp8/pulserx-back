import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CoachProfileController } from './coach-profile.controller';
import { CoachProfileService } from './coach-profile.service';

function build() {
  const service = {
    getMine: jest.fn(), upsert: jest.fn(), setPublished: jest.fn(), uploadBanner: jest.fn(),
  };
  const controller = new CoachProfileController(service as unknown as CoachProfileService);
  return { controller, service };
}

describe('CoachProfileController — guards e roles', () => {
  it('exige JwtAuthGuard + RolesGuard e role coach no controller inteiro', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CoachProfileController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
    expect(Reflect.getMetadata(ROLES_KEY, CoachProfileController)).toEqual(['coach']);
  });
});

describe('CoachProfileController — delegação', () => {
  const req = { user: { id: 'coach-1' } };

  it('getMine usa o id do coach do token', () => {
    const { controller, service } = build();
    controller.getMine(req);
    expect(service.getMine).toHaveBeenCalledWith('coach-1');
  });

  it('upsert repassa o dto', () => {
    const { controller, service } = build();
    const dto = { slug: 'luan', bio: 'Treinador' };
    controller.upsert(req, dto as never);
    expect(service.upsert).toHaveBeenCalledWith('coach-1', dto);
  });

  it('publish repassa o published do dto', () => {
    const { controller, service } = build();
    controller.publish(req, { published: true } as never);
    expect(service.setPublished).toHaveBeenCalledWith('coach-1', true);
  });

  it('uploadBanner repassa o buffer do arquivo', () => {
    const { controller, service } = build();
    const file = { buffer: Buffer.from('img') } as Express.Multer.File;
    controller.uploadBanner(req, file);
    expect(service.uploadBanner).toHaveBeenCalledWith('coach-1', file.buffer);
  });
});
