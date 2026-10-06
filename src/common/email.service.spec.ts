const sendMock = jest.fn();
const ResendCtorMock = jest.fn();

jest.mock('resend', () => ({
  Resend: function (this: unknown, ...args: unknown[]) {
    ResendCtorMock(...args);
    return { emails: { send: sendMock } };
  },
}));

import { EmailService } from './email.service';

describe('EmailService', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; jest.clearAllMocks(); });

  it('sem RESEND_API_KEY/EMAIL_FROM: lança erro explícito ao instanciar', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(() => new EmailService()).toThrow(/RESEND_API_KEY/);
  });

  describe('send', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.EMAIL_FROM = 'onboarding@resend.dev';
    });

    it('envia com from/to/subject/html corretos, sem lançar', async () => {
      sendMock.mockResolvedValue({ data: { id: '1' }, error: null });
      const service = new EmailService();

      await expect(service.send('a@x.com', 'Assunto', '<p>corpo</p>')).resolves.toBeUndefined();

      expect(sendMock).toHaveBeenCalledWith({
        from: 'onboarding@resend.dev', to: 'a@x.com', subject: 'Assunto', html: '<p>corpo</p>',
      });
    });

    it('com a versão só texto: envia junto (ajuda a não cair no spam)', async () => {
      sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
      await new EmailService().send('a@x.com', 'Assunto', '<p>corpo</p>', 'corpo');
      expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ html: '<p>corpo</p>', text: 'corpo' }));
    });

    it('API retorna erro (ex.: domínio não verificado): loga mas não lança', async () => {
      sendMock.mockResolvedValue({ data: null, error: { message: 'domínio não verificado' } });
      const service = new EmailService();

      await expect(service.send('a@x.com', 'Assunto', '<p>corpo</p>')).resolves.toBeUndefined();
    });

    it('client lança Error: captura e não propaga (falha de e-mail não pode derrubar o fluxo)', async () => {
      sendMock.mockRejectedValue(new Error('network'));
      const service = new EmailService();

      await expect(service.send('a@x.com', 'Assunto', '<p>corpo</p>')).resolves.toBeUndefined();
    });

    it('client rejeita com algo que não é Error: também captura sem propagar', async () => {
      sendMock.mockRejectedValue('falha crua, sem stack');
      const service = new EmailService();

      await expect(service.send('a@x.com', 'Assunto', '<p>corpo</p>')).resolves.toBeUndefined();
    });
  });
});
