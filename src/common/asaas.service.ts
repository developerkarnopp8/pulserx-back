import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';

function requireAsaasConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ASAAS_API_KEY não configurado — defina a variável de ambiente antes de iniciar a aplicação.',
    );
  }
  const env = process.env.ASAAS_ENV ?? 'sandbox';
  const baseUrl = env === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
  return { apiKey, baseUrl };
}

export interface AsaasCustomer {
  id: string;
}

export interface AsaasSubscription {
  id: string;
  status: string;
}

/** Cartão guardado na assinatura, só o que pode ser mostrado ao aluno (nunca número completo nem token). */
export interface SavedCard {
  brand: string;
  last4: string;
}

/** QR Code PIX de uma cobrança: imagem PNG em base64, código copia e cola e validade ("AAAA-MM-DD HH:mm:ss", horário de Brasília). */
export interface PixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string | null;
}

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  /** Líquido depois da taxa do Asaas (o Asaas informa em todo pagamento). */
  netValue?: number;
  dueDate: string;
  invoiceUrl: string;
  subscription?: string;
}

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    const { apiKey, baseUrl } = requireAsaasConfig();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
    } catch (err) {
      this.logger.error(`Falha de rede ao chamar o Asaas (${path})`, err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException('Não foi possível conectar ao serviço de pagamentos. Tente novamente em instantes.');
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const description = body?.errors?.[0]?.description;
      this.logger.error(`Asaas retornou erro (${path})`, JSON.stringify({ status: res.status, description }));
      // O texto do Asaas fica só no log: pode citar dado interno (walletId do coach, ids) e não é
      // mensagem pro aluno. Quem chamou recebe um texto neutro, em português.
      if (res.status < 500) throw new BadRequestException('Não foi possível gerar a cobrança agora. Confira seus dados ou fale com o seu treinador.');
      throw new ServiceUnavailableException('O serviço de pagamentos está indisponível no momento. Tente novamente em instantes.');
    }
    return body as T;
  }

  async createCustomer(name: string, email: string, cpfDigits: string): Promise<AsaasCustomer> {
    return this.request<AsaasCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify({ name, email, cpfCnpj: cpfDigits }),
    });
  }

  /**
   * Cria a assinatura recorrente na PLATAFORMA (dono da API key) com split automático pro
   * coach — nunca criamos subconta/KYC pro coach, ele só cadastra o próprio walletId.
   */
  async createSubscription(params: {
    customerId: string;
    valueCents: number;
    walletId: string;
    coachPercent: number;
    externalReference: string;
  }): Promise<AsaasSubscription> {
    return this.request<AsaasSubscription>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: params.customerId,
        // Forma "a escolher": na fatura do Asaas o aluno escolhe PIX, boleto ou cartão a cada mês
        // (decisão do dono). Cartão com débito automático é uma etapa separada.
        billingType: 'UNDEFINED',
        cycle: 'MONTHLY',
        value: params.valueCents / 100,
        nextDueDate: new Date().toISOString().slice(0, 10),
        externalReference: params.externalReference,
        split: [{ walletId: params.walletId, percentualValue: params.coachPercent }],
      }),
    });
  }

  async cancelSubscription(asaasSubscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${asaasSubscriptionId}`, { method: 'DELETE' });
  }

  /** Lista as cobranças já geradas pra uma assinatura — usado pra pegar o invoiceUrl da 1ª cobrança. */
  async listPaymentsBySubscription(asaasSubscriptionId: string): Promise<AsaasPayment[]> {
    const result = await this.request<{ data: AsaasPayment[] }>(`/payments?subscription=${asaasSubscriptionId}`);
    return result.data;
  }

  /**
   * Cartão em que a assinatura é debitada automaticamente (o Asaas guarda o cartão quando o aluno paga uma fatura
   * com cartão — ver docs/ESTUDO_CARTAO_ASAAS.md). Devolve só bandeira e final; `null` se a assinatura não está no cartão.
   * Consulta rápida (5 s): é só informativa, quem chama trata a falha.
   */
  async getSubscriptionCard(asaasSubscriptionId: string): Promise<SavedCard | null> {
    const sub = await this.request<{ billingType?: string; creditCard?: { creditCardNumber?: string; creditCardBrand?: string } }>(
      `/subscriptions/${asaasSubscriptionId}`,
      { signal: AbortSignal.timeout(5000) },
    );
    const last4 = sub.creditCard?.creditCardNumber?.slice(-4);
    if (sub.billingType !== 'CREDIT_CARD' || !last4 || !/^\d{4}$/.test(last4)) return null;
    return { brand: sub.creditCard?.creditCardBrand ?? 'Cartão', last4 };
  }

  /**
   * QR Code PIX de uma cobrança (vale para a forma "a escolher"). Sem chave PIX na conta da plataforma, o Asaas gera um QR que
   * vale só até 23h59 do mesmo dia — por isso a validade vem junto. Só a imagem (base64), o copia e cola e a validade saem daqui.
   */
  async getPixQrCode(asaasPaymentId: string): Promise<PixQrCode> {
    const res = await this.request<{ encodedImage?: string; payload?: string; expirationDate?: string }>(
      `/payments/${encodeURIComponent(asaasPaymentId)}/pixQrCode`,
    );
    if (!res.encodedImage || !res.payload) {
      throw new ServiceUnavailableException('O PIX não está disponível para esta cobrança agora. Use a fatura para pagar.');
    }
    return { encodedImage: res.encodedImage, payload: res.payload, expirationDate: res.expirationDate ?? null };
  }

  /** Reconsulta um pagamento específico — nunca confiar no corpo do webhook sem isso. */
  async getPayment(asaasPaymentId: string): Promise<AsaasPayment> {
    return this.request<AsaasPayment>(`/payments/${asaasPaymentId}`);
  }
}
