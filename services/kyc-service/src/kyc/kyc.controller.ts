import {
  Controller, Get, Post, Body, Param, Req,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe, Headers,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { KycService } from './kyc.service';
import { SubmitKycDto, KycWebhookDto, AdminReviewDto } from './dto/kyc.dto';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(private svc: KycService) {}

  // ─── User endpoints ─────────────────────────────────────────────

  @Post('submit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Submit KYC documents',
    description: 'Submit KYC with provider reference ID. Verification is async — status updates via /kyc/status.',
  })
  submit(@Req() req: any, @Body() dto: SubmitKycDto) {
    return this.svc.submit(req.user.sub, dto);
  }

  @Post('resubmit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Re-submit KYC after rejection' })
  resubmit(@Req() req: any, @Body() dto: SubmitKycDto) {
    return this.svc.resubmit(req.user.sub, dto);
  }

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Get current user KYC status',
    description: 'Returns kycStatus (PENDING | SUBMITTED | APPROVED | REJECTED), canTransact flag, and latest application details.',
  })
  status(@Req() req: any) {
    return this.svc.getStatus(req.user.sub);
  }

  // ─── Provider webhooks (no auth — validate HMAC in production) ──

  @Post('webhook/hyperverge')
  @ApiOperation({ summary: 'HyperVerge async verification webhook' })
  webhookHyperverge(@Body() dto: KycWebhookDto, @Headers('x-hmac-sha256') sig: string) {
    // TODO: validate sig against HYPERVERGE_WEBHOOK_SECRET
    return this.svc.handleWebhook(dto);
  }

  @Post('webhook/onfido')
  @ApiOperation({ summary: 'Onfido async verification webhook' })
  webhookOnfido(@Body() body: any, @Headers('x-sha2-signature') sig: string) {
    // Onfido sends { payload: { resource_type, action, object: { id, status, result } } }
    const payload = body?.payload?.object;
    if (!payload) return { ok: true };
    const dto: KycWebhookDto = {
      referenceId: payload.id,
      status:      payload.result === 'clear' ? 'approved' : payload.result === 'consider' ? 'needs_review' : 'rejected',
      rejectionReason: payload.result !== 'clear' ? `Onfido result: ${payload.result}` : undefined,
      providerData: payload,
    };
    return this.svc.handleWebhook(dto);
  }

  @Post('webhook/digilocker')
  @ApiOperation({ summary: 'DigiLocker async verification webhook' })
  webhookDigilocker(@Body() dto: KycWebhookDto) {
    return this.svc.handleWebhook(dto);
  }

  // ─── Admin endpoints ─────────────────────────────────────────────

  @Get('applications')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'List all KYC applications with optional filters (admin)' })
  @ApiQuery({ name: 'status',   required: false, example: 'SUBMITTED' })
  @ApiQuery({ name: 'provider', required: false, example: 'hyperverge' })
  all(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:     number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit:    number,
    @Query('status')   status?:   string,
    @Query('provider') provider?: string,
  ) {
    return this.svc.getAll({ page, limit, status, provider });
  }

  @Get('applications/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get a specific KYC application by ID (admin)' })
  getById(@Param('id') id: string) {
    return this.svc.getApplicationById(id);
  }

  @Get('stats')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get KYC statistics (admin): total, approved, rejected, approval rate' })
  stats() {
    return this.svc.getStats();
  }

  @Post('approve/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Manually approve a KYC application (admin)' })
  approve(@Param('id') id: string, @Req() req: any) {
    return this.svc.approve(id, req.user.sub);
  }

  @Post('reject/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Manually reject a KYC application (admin)' })
  reject(@Param('id') id: string, @Body() dto: AdminReviewDto, @Req() req: any) {
    return this.svc.reject(id, dto.reason, req.user.sub);
  }
}
