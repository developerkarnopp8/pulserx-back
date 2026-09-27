import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('SessionsController', () => {
  it('exige JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SessionsController)).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('findById repassa id + req.user (a checagem de dono é no service)', () => {
    const service = { findById: jest.fn().mockResolvedValue({ id: 'sess-1' }) };
    const controller = new SessionsController(service as unknown as SessionsService);
    const req = { user: { id: 'athlete-1', role: 'athlete' } };

    controller.findById('sess-1', req);

    expect(service.findById).toHaveBeenCalledWith('sess-1', req.user);
  });
});
