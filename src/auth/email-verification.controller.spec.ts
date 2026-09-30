import { EmailVerificationController } from './email-verification.controller';

describe('EmailVerificationController', () => {
  it('confirmar: repassa o token e devolve a sessão', async () => {
    const service = { verify: jest.fn().mockResolvedValue({ access_token: 'x' }), resend: jest.fn() };
    const controller = new EmailVerificationController(service as never);
    await expect(controller.verify({ token: 't'.repeat(43) })).resolves.toEqual({ access_token: 'x' });
    expect(service.verify).toHaveBeenCalledWith('t'.repeat(43));
  });

  it('reenviar: sempre a mesma resposta', async () => {
    const service = { verify: jest.fn(), resend: jest.fn().mockResolvedValue(undefined) };
    const controller = new EmailVerificationController(service as never);
    await expect(controller.resend({ email: 'ana@example.com' })).resolves.toEqual({
      message: 'Se houver uma conta esperando confirmação com esse e-mail, enviamos um novo link.',
    });
    expect(service.resend).toHaveBeenCalledWith('ana@example.com');
  });
});
