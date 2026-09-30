import { PasswordResetController } from './password-reset.controller';

describe('PasswordResetController', () => {
  it('esqueci minha senha: sempre a mesma resposta', async () => {
    const service = { requestReset: jest.fn().mockResolvedValue(undefined), resetPassword: jest.fn() };
    const controller = new PasswordResetController(service as never);
    await expect(controller.forgot({ email: 'ana@example.com' })).resolves.toEqual({
      message: 'Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha.',
    });
    expect(service.requestReset).toHaveBeenCalledWith('ana@example.com');
  });

  it('redefinir: repassa token e senha', async () => {
    const service = { requestReset: jest.fn(), resetPassword: jest.fn().mockResolvedValue({ reset: true }) };
    const controller = new PasswordResetController(service as never);
    await expect(controller.reset({ token: 't'.repeat(43), password: 'senha-forte' })).resolves.toEqual({ reset: true });
    expect(service.resetPassword).toHaveBeenCalledWith('t'.repeat(43), 'senha-forte');
  });
});
