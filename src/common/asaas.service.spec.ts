import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AsaasService } from './asaas.service';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('AsaasService', () => {
  const OLD_ENV = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.ASAAS_API_KEY = 'test-key';
    process.env.ASAAS_ENV = 'sandbox';
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => { process.env = { ...OLD_ENV }; jest.restoreAllMocks(); });

  it('sem ASAAS_API_KEY: lança erro explícito ao instanciar', () => {
    delete process.env.ASAAS_API_KEY;
    expect(() => new AsaasService()).toThrow(/ASAAS_API_KEY não configurado/);
  });

  it('usa a URL de produção quando ASAAS_ENV=production', async () => {
    process.env.ASAAS_ENV = 'production';
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'cus_1' }));
    const service = new AsaasService();

    await service.createCustomer('Ana', 'ana@x.com', '52998224725');

    expect(fetchMock).toHaveBeenCalledWith('https://api.asaas.com/v3/customers', expect.any(Object));
  });

  it('usa a URL de sandbox por padrão', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'cus_1' }));
    const service = new AsaasService();

    await service.createCustomer('Ana', 'ana@x.com', '52998224725');

    expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/customers', expect.any(Object));
  });

  it('sem ASAAS_ENV definido: cai no default sandbox (não exige a variável)', async () => {
    delete process.env.ASAAS_ENV;
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'cus_1' }));
    const service = new AsaasService();

    await service.createCustomer('Ana', 'ana@x.com', '52998224725');

    expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/customers', expect.any(Object));
  });

  describe('createCustomer', () => {
    it('envia nome/email/cpfCnpj e devolve o customer criado', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'cus_1' }));
      const service = new AsaasService();

      const result = await service.createCustomer('Ana', 'ana@x.com', '52998224725');

      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe('https://api-sandbox.asaas.com/v3/customers');
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(call[1].body)).toEqual({ name: 'Ana', email: 'ana@x.com', cpfCnpj: '52998224725' });
      expect(call[1].headers.access_token).toBe('test-key');
      expect(result).toEqual({ id: 'cus_1' });
    });
  });

  describe('createSubscription', () => {
    it('monta o payload certo: forma a escolher, mensal, valor em reais, split pro coach', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'sub_1', status: 'ACTIVE' }));
      const service = new AsaasService();

      await service.createSubscription({
        customerId: 'cus_1', valueCents: 14900, walletId: 'wallet-1', coachPercent: 80, externalReference: 'local-sub-1',
      });

      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe('https://api-sandbox.asaas.com/v3/subscriptions');
      const body = JSON.parse(call[1].body);
      expect(body.customer).toBe('cus_1');
      expect(body.billingType).toBe('UNDEFINED'); // aluno escolhe PIX, boleto ou cartão na fatura
      expect(body.cycle).toBe('MONTHLY');
      expect(body.value).toBe(149);
      expect(body.externalReference).toBe('local-sub-1');
      expect(body.split).toEqual([{ walletId: 'wallet-1', percentualValue: 80 }]);
      expect(body.nextDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('cancelSubscription', () => {
    it('chama DELETE /subscriptions/:id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));
      const service = new AsaasService();

      await service.cancelSubscription('sub_1');

      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe('https://api-sandbox.asaas.com/v3/subscriptions/sub_1');
      expect(call[1].method).toBe('DELETE');
    });
  });

  describe('listPaymentsBySubscription', () => {
    it('chama GET /payments?subscription=:id e devolve a lista', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ id: 'pay_1', status: 'PENDING', value: 149, dueDate: '2026-10-01', invoiceUrl: 'https://x' }] }));
      const service = new AsaasService();

      const result = await service.listPaymentsBySubscription('sub_1');

      expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/payments?subscription=sub_1', expect.any(Object));
      expect(result).toEqual([{ id: 'pay_1', status: 'PENDING', value: 149, dueDate: '2026-10-01', invoiceUrl: 'https://x' }]);
    });
  });

  describe('getPixQrCode', () => {
    it('chama GET /payments/:id/pixQrCode e devolve só imagem, copia e cola e validade', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {
        encodedImage: 'iVBORw0KGgo=', payload: '00020126pix', expirationDate: '2026-10-06 23:59:59', description: 'Plano X', success: true,
      }));
      const service = new AsaasService();

      const result = await service.getPixQrCode('pay_1');

      expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/payments/pay_1/pixQrCode', expect.any(Object));
      expect(result).toEqual({ encodedImage: 'iVBORw0KGgo=', payload: '00020126pix', expirationDate: '2026-10-06 23:59:59' });
    });

    it('id com caractere especial vai codificado na URL', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { encodedImage: 'a', payload: 'b' }));
      await new AsaasService().getPixQrCode('pay/../x');
      expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/payments/pay%2F..%2Fx/pixQrCode', expect.any(Object));
    });

    it('sem validade informada: devolve null', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { encodedImage: 'a', payload: 'b' }));
      expect((await new AsaasService().getPixQrCode('pay_1')).expirationDate).toBeNull();
    });

    it('resposta sem QR (PIX indisponível): ServiceUnavailableException com orientação para a fatura', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { success: false }));
      await expect(new AsaasService().getPixQrCode('pay_1')).rejects.toThrow(/Use a fatura/);
    });
  });

  describe('getPayment', () => {
    it('chama GET /payments/:id e devolve o pagamento', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'pay_1', status: 'CONFIRMED', value: 149, dueDate: '2026-10-01', invoiceUrl: 'https://x' }));
      const service = new AsaasService();

      const result = await service.getPayment('pay_1');

      expect(fetchMock).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/payments/pay_1', expect.any(Object));
      expect(result.status).toBe('CONFIRMED');
    });
  });

  describe('getSubscriptionCard — cartão do débito automático', () => {
    it('assinatura no cartão: só bandeira e os 4 últimos dígitos (nunca token); consulta com limite de tempo', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {
        id: 'sub_1', billingType: 'CREDIT_CARD',
        creditCard: { creditCardNumber: '8829', creditCardBrand: 'MASTERCARD', creditCardToken: 'tok_secreto' },
      }));
      const service = new AsaasService();

      await expect(service.getSubscriptionCard('sub_1')).resolves.toEqual({ brand: 'MASTERCARD', last4: '8829' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api-sandbox.asaas.com/v3/subscriptions/sub_1');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('número vindo com máscara: pega só o final; sem bandeira mostra "Cartão"', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { billingType: 'CREDIT_CARD', creditCard: { creditCardNumber: '**** 1234' } }));
      await expect(new AsaasService().getSubscriptionCard('sub_1')).resolves.toEqual({ brand: 'Cartão', last4: '1234' });
    });

    it.each([
      ['assinatura em PIX/boleto/indefinida', { billingType: 'UNDEFINED', creditCard: { creditCardNumber: '8829' } }],
      ['no cartão mas sem cartão guardado', { billingType: 'CREDIT_CARD' }],
      ['final que não é número', { billingType: 'CREDIT_CARD', creditCard: { creditCardNumber: 'abcd' } }],
    ])('%s → null', async (_caso, body) => {
      fetchMock.mockResolvedValue(jsonResponse(200, body));
      await expect(new AsaasService().getSubscriptionCard('sub_1')).resolves.toBeNull();
    });
  });

  describe('tratamento de erro', () => {
    it('erro 4xx: texto do Asaas NUNCA vai pro cliente (pode citar walletId/ids) — só pro log', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { errors: [{ description: 'Wallet [00000000-0000] inexistente.' }] }));
      const service = new AsaasService();
      const logSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      const err = await service.createCustomer('Ana', 'ana@x.com', '000').catch(e => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Não foi possível gerar a cobrança agora. Confira seus dados ou fale com o seu treinador.');
      expect(err.message).not.toContain('Wallet');
      expect(JSON.stringify(logSpy.mock.calls)).toContain('inexistente');
    });

    it('erro 4xx sem description: mesma mensagem neutra', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, {}));
      const service = new AsaasService();

      await expect(service.createCustomer('Ana', 'ana@x.com', '000')).rejects.toThrow('Não foi possível gerar a cobrança agora.');
    });

    it('erro 5xx: ServiceUnavailableException', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, {}));
      const service = new AsaasService();

      await expect(service.createCustomer('Ana', 'ana@x.com', '000')).rejects.toThrow(ServiceUnavailableException);
    });

    it('falha de rede (fetch rejeita com Error): ServiceUnavailableException', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const service = new AsaasService();

      await expect(service.createCustomer('Ana', 'ana@x.com', '000')).rejects.toThrow(ServiceUnavailableException);
    });

    it('falha de rede (fetch rejeita com algo que não é Error): também vira ServiceUnavailableException', async () => {
      fetchMock.mockRejectedValue('conexão recusada');
      const service = new AsaasService();

      await expect(service.createCustomer('Ana', 'ana@x.com', '000')).rejects.toThrow(ServiceUnavailableException);
    });

    it('corpo de resposta não é JSON válido mas status ok: não lança', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } } as unknown as Response);
      const service = new AsaasService();

      await expect(service.cancelSubscription('sub_1')).resolves.toBeUndefined();
    });
  });
});
