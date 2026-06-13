import {
  Controller, Get, Post, Body, Param, Req,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }        from '@nestjs/passport';
import { PaymentService }   from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { MarkPaidDto }      from './dto/mark-paid.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(private svc: PaymentService) {}

  @Post()
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary:'Create payment request + QR code (merchant)' })
  create(@Req() req:any, @Body() dto:CreatePaymentDto) { return this.svc.create(req.user.sub, dto); }

  @Get(':id')
  @ApiOperation({ summary:'Get payment by ID — PUBLIC (wallet app uses this after QR scan)' })
  getById(@Param('id') id:string) { return this.svc.getById(id); }

  @Post(':id/paid')
  @ApiOperation({ summary:'Mark payment paid — called by listener-service on tx detection' })
  markPaid(@Param('id') id:string, @Body() dto:MarkPaidDto) { return this.svc.markPaid(id, dto); }

  @Get()
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary:'Merchant payment history (paginated)' })
  @ApiQuery({ name:'page', required:false, type:Number })
  @ApiQuery({ name:'limit', required:false, type:Number })
  @ApiQuery({ name:'status', required:false, enum:['PENDING','PAID','EXPIRED','CANCELLED'] })
  list(@Req() req:any, @Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number, @Query('limit',new DefaultValuePipe(20),ParseIntPipe) limit:number, @Query('status') status?:string) {
    return this.svc.getMerchantPayments(req.user.sub, page, limit, status);
  }

  @Get('stats/overview')
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary:'Merchant stats — totals, conversion rate, revenue by token' })
  stats(@Req() req:any) { return this.svc.getMerchantStats(req.user.sub); }

  @Post(':id/cancel')
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary:'Cancel a pending payment' })
  cancel(@Param('id') id:string, @Req() req:any) { return this.svc.cancel(id, req.user.sub); }
}
