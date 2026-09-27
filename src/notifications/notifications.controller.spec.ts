import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

function build() {
  const service = { findAllForUser: jest.fn(), unreadCount: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn() };
  const controller = new NotificationsController(service as unknown as NotificationsService);
  return { controller, service };
}

describe('NotificationsController', () => {
  it('exige JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, NotificationsController)).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('findAll usa o id do usuário do token', () => {
    const { controller, service } = build();
    controller.findAll({ user: { id: 'u1' } });
    expect(service.findAllForUser).toHaveBeenCalledWith('u1');
  });

  it('unreadCount devolve { count }', async () => {
    const { controller, service } = build();
    service.unreadCount.mockResolvedValue(5);
    await expect(controller.unreadCount({ user: { id: 'u1' } })).resolves.toEqual({ count: 5 });
  });

  it('markAsRead repassa id + userId do token', () => {
    const { controller, service } = build();
    controller.markAsRead('n1', { user: { id: 'u1' } });
    expect(service.markAsRead).toHaveBeenCalledWith('n1', 'u1');
  });

  it('markAllAsRead usa o id do usuário do token', () => {
    const { controller, service } = build();
    controller.markAllAsRead({ user: { id: 'u1' } });
    expect(service.markAllAsRead).toHaveBeenCalledWith('u1');
  });
});
