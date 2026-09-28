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
      if (res.status < 500) throw new BadRequestException(description || 'Não foi possível concluir a operação com o gateway de pagamento.');
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
        billingType: 'PIX',
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

  /** Reconsulta um pagamento específico — nunca confiar no corpo do webhook sem isso. */
  async getPayment(asaasPaymentId: string): Promise<AsaasPayment> {
    return this.request<AsaasPayment>(`/payments/${asaasPaymentId}`);
  }
}
