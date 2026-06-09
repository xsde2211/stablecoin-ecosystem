import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface ProviderVerificationResult {
  status:    'approved' | 'rejected' | 'needs_review';
  reason?:   string;
  data?:     Record<string, any>;
}

/**
 * KYC Provider clients.
 * In production each provider has a real API integration.
 * Stubs are kept minimal — wire in actual credentials and endpoints.
 */
@Injectable()
export class KycProviderService {
  private readonly logger = new Logger(KycProviderService.name);

  // ─── HyperVerge ─────────────────────────────────────────────────

  async hypervergeVerify(referenceId: string): Promise<ProviderVerificationResult> {
    const appId  = process.env.HYPERVERGE_APP_ID;
    const appKey = process.env.HYPERVERGE_APP_KEY;

    if (!appId || !appKey) {
      this.logger.warn('HYPERVERGE_APP_ID/HYPERVERGE_APP_KEY not set — using simulation');
      return this.simulateResult(referenceId);
    }

    try {
      const response = await axios.post(
        'https://ind-docs.hyperverge.co/v2-0/readKYC',
        { transactionId: referenceId },
        {
          headers: {
            'appId':  appId,
            'appKey': appKey,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      const result = response.data;
      if (result?.status === 'success' && result?.result?.summary?.action === 'pass') {
        return { status: 'approved', data: result.result };
      }
      return {
        status: 'rejected',
        reason: result?.result?.summary?.details?.[0]?.message ?? 'HyperVerge verification failed',
        data:   result?.result,
      };
    } catch (err: any) {
      this.logger.error('HyperVerge API error:', err.message);
      return { status: 'needs_review', reason: 'Provider API error — manual review required' };
    }
  }

  // ─── DigiLocker ─────────────────────────────────────────────────

  async digilockerVerify(referenceId: string): Promise<ProviderVerificationResult> {
    const clientId     = process.env.DIGILOCKER_CLIENT_ID;
    const clientSecret = process.env.DIGILOCKER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      this.logger.warn('DIGILOCKER_CLIENT_ID/SECRET not set — using simulation');
      return this.simulateResult(referenceId);
    }

    try {
      // Exchange auth code for access token
      const tokenResp = await axios.post(
        'https://api.digitallocker.gov.in/public/oauth2/1/token',
        new URLSearchParams({
          code:          referenceId,
          grant_type:    'authorization_code',
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  process.env.DIGILOCKER_REDIRECT_URI ?? '',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
      );

      const accessToken = tokenResp.data?.access_token;
      if (!accessToken) return { status: 'rejected', reason: 'DigiLocker auth failed' };

      // Fetch issued documents list to confirm identity
      const docsResp = await axios.get(
        'https://api.digitallocker.gov.in/public/oauth2/1/xml/eaadhaar',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15000,
        },
      );

      if (docsResp.status === 200) {
        return { status: 'approved', data: { accessToken: '***', digilockerRef: referenceId } };
      }
      return { status: 'rejected', reason: 'DigiLocker document fetch failed' };
    } catch (err: any) {
      this.logger.error('DigiLocker API error:', err.message);
      return { status: 'needs_review', reason: 'DigiLocker API error' };
    }
  }

  // ─── Onfido ─────────────────────────────────────────────────────

  async onfidoVerify(referenceId: string): Promise<ProviderVerificationResult> {
    const apiToken = process.env.ONFIDO_API_TOKEN;

    if (!apiToken) {
      this.logger.warn('ONFIDO_API_TOKEN not set — using simulation');
      return this.simulateResult(referenceId);
    }

    try {
      // referenceId = Onfido check ID
      const response = await axios.get(
        `https://api.onfido.com/v3.6/checks/${referenceId}`,
        {
          headers: { Authorization: `Token token=${apiToken}` },
          timeout: 15000,
        },
      );

      const check = response.data;
      if (check?.status === 'complete') {
        const passed = check?.result === 'clear';
        return {
          status: passed ? 'approved' : 'rejected',
          reason: passed ? undefined : `Onfido result: ${check.result}`,
          data:   check,
        };
      }
      return { status: 'needs_review', reason: `Onfido check in status: ${check?.status}` };
    } catch (err: any) {
      this.logger.error('Onfido API error:', err.message);
      return { status: 'needs_review', reason: 'Onfido API error' };
    }
  }

  // ─── Dispatch ────────────────────────────────────────────────────

  async verify(provider: string, referenceId: string): Promise<ProviderVerificationResult> {
    switch (provider) {
      case 'hyperverge': return this.hypervergeVerify(referenceId);
      case 'digilocker': return this.digilockerVerify(referenceId);
      case 'onfido':     return this.onfidoVerify(referenceId);
      default:           return this.simulateResult(referenceId);
    }
  }

  // ─── Simulation fallback ─────────────────────────────────────────

  private simulateResult(referenceId: string): ProviderVerificationResult {
    // In dev/test: simulate provider response
    // Use referenceId prefix to control outcome for testing:
    //   "REJECT-..." → rejected
    //   "REVIEW-..." → needs_review
    //   anything else → approved
    if (referenceId.startsWith('REJECT-')) return { status: 'rejected', reason: 'Simulated rejection' };
    if (referenceId.startsWith('REVIEW-')) return { status: 'needs_review', reason: 'Simulated manual review' };
    return { status: 'approved', data: { simulated: true } };
  }
}
