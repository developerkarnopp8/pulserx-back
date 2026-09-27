import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CoachProfileController } from './coach-profile.controller';
import { CoachProfileService } from './coach-profile.service';

function build() {
  const service = {
    getMine: jest.fn(), upsert: jest.fn(), setPublished: jest.fn(), uploadBanner: jest.fn(), uploadPhoto: jest.fn(),
    listTestimonials: jest.fn(), createTestimonial: jest.fn(), updateTestimonial: jest.fn(), removeTestimonial: jest.fn(),
    listFaqItems: jest.fn(), createFaqItem: jest.fn(), updateFaqItem: jest.fn(), removeFaqItem: jest.fn(),
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

  it('uploadPhoto repassa o buffer do arquivo', () => {
    const { controller, service } = build();
    const file = { buffer: Buffer.from('img') } as Express.Multer.File;
    controller.uploadPhoto(req, file);
    expect(service.uploadPhoto).toHaveBeenCalledWith('coach-1', file.buffer);
  });

  it('listTestimonials/createTestimonial usam o id do coach do token', () => {
    const { controller, service } = build();
    controller.listTestimonials(req);
    expect(service.listTestimonials).toHaveBeenCalledWith('coach-1');
    const dto = { authorName: 'Ana', content: 'Ótimo!' };
    controller.createTestimonial(req, dto as never);
    expect(service.createTestimonial).toHaveBeenCalledWith('coach-1', dto);
  });

  it('updateTestimonial/removeTestimonial repassam id + coachId do token', () => {
    const { controller, service } = build();
    const dto = { authorName: 'Ana 2', content: 'X' };
    controller.updateTestimonial('t1', req, dto as never);
    expect(service.updateTestimonial).toHaveBeenCalledWith('t1', 'coach-1', dto);
    controller.removeTestimonial('t1', req);
    expect(service.removeTestimonial).toHaveBeenCalledWith('t1', 'coach-1');
  });

  it('listFaqItems/createFaqItem usam o id do coach do token', () => {
    const { controller, service } = build();
    controller.listFaqItems(req);
    expect(service.listFaqItems).toHaveBeenCalledWith('coach-1');
    const dto = { question: 'Q?', answer: 'A.' };
    controller.createFaqItem(req, dto as never);
    expect(service.createFaqItem).toHaveBeenCalledWith('coach-1', dto);
  });

  it('updateFaqItem/removeFaqItem repassam id + coachId do token', () => {
    const { controller, service } = build();
    const dto = { question: 'Q2', answer: 'A2' };
    controller.updateFaqItem('f1', req, dto as never);
    expect(service.updateFaqItem).toHaveBeenCalledWith('f1', 'coach-1', dto);
    controller.removeFaqItem('f1', req);
    expect(service.removeFaqItem).toHaveBeenCalledWith('f1', 'coach-1');
  });
});
