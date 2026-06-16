import { Controller, Get, Post, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard }            from '@nestjs/passport';
import { MerchantService }      from './merchant.service';
import { RegisterMerchantDto }  from './dto/register-merchant.dto';
import { UpdateMerchantDto }    from './dto/update-merchant.dto';

@ApiTags('Merchant')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('merchant')
export class MerchantController {
  constructor(private svc: MerchantService) {}

  @Post('register')
  @ApiOperation({
    summary:     'Register as merchant',
    description: 'Returns API key/secret pair ONCE. Save the secret immediately — it cannot be retrieved again.',
  })
  register(@Req() req: any, @Body() dto: RegisterMerchantDto) {
    return this.svc.register(req.user.sub, dto);
  }

  @Get('profile')
  @ApiOperation({ summary:'Get merchant profile' })
  profile(@Req() req: any) { return this.svc.getProfile(req.user.sub); }

  @Patch('profile')
  @ApiOperation({ summary:'Update merchant profile — business details, settlement address' })
  update(@Req() req: any, @Body() dto: UpdateMerchantDto) { return this.svc.updateProfile(req.user.sub, dto); }

  @Post('rotate-key')
  @ApiOperation({
    summary:     'Rotate API key/secret',
    description: 'Invalidates old key immediately. New secret shown ONCE.',
  })
  rotateKey(@Req() req: any) { return this.svc.rotateKey(req.user.sub); }

  @Get('stats')
  @ApiOperation({ summary:'Merchant stats — payments, conversion rate, revenue by token' })
  stats(@Req() req: any) { return this.svc.getStats(req.user.sub); }
}
