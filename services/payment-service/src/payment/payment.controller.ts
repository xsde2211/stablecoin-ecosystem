import {
  Controller, Get, Post, Body, Param, Req, UseGuards,
  Query, DefaultValuePipe, ParseIntPipe,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { PaymentService } from "./payment.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { MarkPaidDto } from "./dto/mark-paid.dto";

@ApiTags("Payments")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("payments")
export class PaymentController {
  constructor(private svc: PaymentService) {}

  @Post()
  @ApiOperation({ summary: "Create a payment request + QR code" })
  create(@Req() req: any, @Body() dto: CreatePaymentDto) {
    return this.svc.create(req.user.merchantId, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get payment by ID" })
  getById(@Param("id") id: string) { return this.svc.getById(id); }

  @Post(":id/paid")
  @ApiOperation({ summary: "Mark payment as paid (called by listener service)" })
  markPaid(@Param("id") id: string, @Body() dto: MarkPaidDto) { return this.svc.markPaid(id, dto); }

  @Get()
  @ApiOperation({ summary: "List merchant payments" })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "status", required: false })
  list(
    @Req() req: any,
    @Query("page",  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query("status") status?: string,
  ) {
    return this.svc.getMerchantPayments(req.user.merchantId, page, limit, status);
  }
}
