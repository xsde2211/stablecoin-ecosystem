import { Controller, Get, Post, Body, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { StablecoinService } from "./stablecoin.service";
import { MintDto } from "./dto/mint.dto";
import { BurnDto } from "./dto/burn.dto";

@ApiTags("Stablecoin")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("stablecoin")
export class StablecoinController {
  constructor(private svc: StablecoinService) {}

  @Get("info/:token/:chain")
  @ApiOperation({ summary: "Get token info on a specific chain" })
  info(@Param("token") token: string, @Param("chain") chain: string) {
    return this.svc.getTokenInfo(token, chain);
  }

  @Get("info/:token")
  @ApiOperation({ summary: "Get token info across all chains" })
  infoAllChains(@Param("token") token: string) {
    return this.svc.getTokenInfoAllChains(token);
  }

  @Get("supply")
  @ApiOperation({ summary: "Get total supply of all tokens across all chains" })
  supply() {
    return this.svc.getTotalSupplyAllTokens();
  }

  @Post("mint")
  @ApiOperation({ summary: "Mint tokens (treasury/admin only)" })
  mint(@Body() dto: MintDto, @Req() req: any) {
    return this.svc.mintTokens(dto, req.user.sub);
  }

  @Post("burn")
  @ApiOperation({ summary: "Burn tokens (treasury/admin only)" })
  burn(@Body() dto: BurnDto, @Req() req: any) {
    return this.svc.burnTokens(dto, req.user.sub);
  }
}
