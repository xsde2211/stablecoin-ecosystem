import { Controller, Get, Post, Patch, Body, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { MerchantService } from "./merchant.service";
import { RegisterMerchantDto } from "./dto/register-merchant.dto";
import { UpdateMerchantDto } from "./dto/update-merchant.dto";

@ApiTags("Merchant")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("merchant")
export class MerchantController {
  constructor(private svc: MerchantService) {}

  @Post("register")
  @ApiOperation({ summary: "Register as a merchant" })
  register(@Req() req: any, @Body() dto: RegisterMerchantDto) { return this.svc.register(req.user.sub, dto); }

  @Get("profile")
  @ApiOperation({ summary: "Get merchant profile" })
  profile(@Req() req: any) { return this.svc.getProfile(req.user.sub); }

  @Patch("profile")
  @ApiOperation({ summary: "Update merchant profile" })
  update(@Req() req: any, @Body() dto: UpdateMerchantDto) { return this.svc.update(req.user.sub, dto); }

  @Post("rotate-key")
  @ApiOperation({ summary: "Rotate API key" })
  rotateKey(@Req() req: any) { return this.svc.rotateApiKey(req.user.sub); }

  @Get("stats")
  @ApiOperation({ summary: "Get payment statistics" })
  stats(@Req() req: any) { return this.svc.getStats(req.user.sub); }
}
