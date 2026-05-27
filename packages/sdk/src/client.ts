import type {
  CreatePaymentDto,
  PaymentRequest,
  PaymentStatus,
} from '@ecosystem/types';

interface SDKConfig {
  apiKey:   string;
  baseUrl?: string;
  timeout?: number;  // ms, default 10000
}

export class StablecoinSDK {
  private apiKey:  string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: SDKConfig) {
    this.apiKey  = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.yourdomain.com/v1';
    this.timeout = config.timeout ?? 10_000;
  }

  // ─── Payments ──────────────────────────────────────────────────

  async createPayment(params: CreatePaymentDto): Promise<PaymentRequest> {
    return this.post('/payments', params);
  }

  async getPayment(paymentId: string): Promise<PaymentRequest> {
    return this.get(`/payments/${paymentId}`);
  }

  async listPayments(filters?: {
    status?: PaymentStatus;
    from?:   string;   // ISO date
    to?:     string;
    page?:   number;
    limit?:  number;
  }): Promise<{ data: PaymentRequest[]; total: number }> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.from)   params.set('from', filters.from);
    if (filters?.to)     params.set('to', filters.to);
    if (filters?.page)   params.set('page', String(filters.page));
    if (filters?.limit)  params.set('limit', String(filters.limit));
    return this.get(`/payments?${params.toString()}`);
  }

  // ─── Webhooks ──────────────────────────────────────────────────

  verifyWebhook(rawBody: string, signature: string): boolean {
    // Lazy-load crypto to keep SDK lightweight in browser
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', this.apiKey)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  }

  // ─── HTTP helpers ──────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request('POST', path, body);
  }

  private async request<T>(
    method: string,
    path:   string,
    body?:  unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key':    this.apiKey,
        },
        body:   body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new SDKError(
          error.message ?? `Request failed: ${res.status}`,
          res.status,
          error.code,
        );
      }

      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

export class SDKError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'SDKError';
  }
}