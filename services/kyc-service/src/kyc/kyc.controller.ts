import {
  Controller, Get, Post, Body, Param, Req,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }    from '@nestjs/passport';
import { KycService }   from './kyc.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { RejectKycDto } from './dto/reject-kyc.dto';

@ApiTags('KYC')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('kyc')
export class KycController {
  constructor(private svc: KycService) {}

  @Post('submit')
  @ApiOperation({ summary:'Submit KYC — use provider=manual & documentRef=DEMO-xxx for instant approval in dev' })
  submit(@Body() dto: SubmitKycDto, @Req() req: any) { return this.svc.submit(req.user.sub, dto); }

  @Get('status')
  @ApiOperation({ summary:'Get own KYC status and latest application' })
  status(@Req() req: any) { return this.svc.getStatus(req.user.sub); }

  @Get('applications')
  @ApiOperation({ summary:'Get all KYC applications — admin only' })
  @ApiQuery({ name:'page',   required:false, type:Number })
  @ApiQuery({ name:'limit',  required:false, type:Number })
  @ApiQuery({ name:'status', required:false, enum:['SUBMITTED','APPROVED','REJECTED'] })
  applications(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) { return this.svc.getAllApplications(page, limit, status); }

  @Get('application/:id')
  @ApiOperation({ summary:'Get single KYC application' })
  application(@Param('id') id: string) { return this.svc.getApplication(id); }

  @Post('approve/:id')
  @ApiOperation({ summary:'Approve KYC application — compliance/admin' })
  approve(@Param('id') id: string, @Req() req: any) { return this.svc.approve(id, req.user.sub); }

  @Post('reject/:id')
  @ApiOperation({ summary:'Reject KYC application with reason' })
  reject(@Param('id') id: string, @Body() dto: RejectKycDto, @Req() req: any) {
    return this.svc.reject(id, dto, req.user.sub);
  }

  @Get('stats')
  @ApiOperation({ summary:'KYC stats — total, pending, approved, rejected' })
  stats() { return this.svc.getStats(); }
}
