import { Controller, Get, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { AnalyticsService } from "./analytics.service";

@ApiTags("Analytics")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("analytics")
export class AnalyticsController {
  constructor(private svc: AnalyticsService) {}

  @Get("dashboard") @ApiOperation({ summary: "Get dashboard stats" })
  dashboard() { return this.svc.getDashboardStats(); }

  @Get("volume/chain") @ApiOperation({ summary: "Volume by chain" })
  @ApiQuery({ name: "days", required: false })
  volumeByChain(@Query("days", new DefaultValuePipe(7), ParseIntPipe) days: number) { return this.svc.getVolumeByChain(days); }

  @Get("volume/token") @ApiOperation({ summary: "Volume by token" })
  @ApiQuery({ name: "days", required: false })
  volumeByToken(@Query("days", new DefaultValuePipe(7), ParseIntPipe) days: number) { return this.svc.getVolumeByToken(days); }

  @Get("volume/daily") @ApiOperation({ summary: "Daily volume chart data" })
  @ApiQuery({ name: "days", required: false })
  daily(@Query("days", new DefaultValuePipe(30), ParseIntPipe) days: number) { return this.svc.getDailyVolume(days); }

  @Get("bridge") @ApiOperation({ summary: "Bridge transfer statistics" })
  bridge() { return this.svc.getBridgeStats(); }

  @Get("top-users") @ApiOperation({ summary: "Top users by transaction volume" })
  topUsers() { return this.svc.getTopUsers(); }
}
