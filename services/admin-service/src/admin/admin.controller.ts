import {
  Controller, Get, Post, Patch, Body, Param, Req,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { AdminService } from "./admin.service";
import { SuspendUserDto }    from "./dto/suspend-user.dto";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto";

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("admin")
export class AdminController {
  constructor(private svc: AdminService) {}

  // Users
  @Get("users")
  @ApiOperation({ summary: "List all users" })
  @ApiQuery({ name: "page",   required: false })
  @ApiQuery({ name: "limit",  required: false })
  @ApiQuery({ name: "search", required: false })
  users(
    @Query("page",  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("search") search?: string,
  ) { return this.svc.getUsers(page, limit, search); }

  @Get("users/:id")
  @ApiOperation({ summary: "Get user details" })
  userById(@Param("id") id: string) { return this.svc.getUserById(id); }

  @Post("users/:id/suspend")
  @ApiOperation({ summary: "Suspend a user account" })
  suspend(@Param("id") id: string, @Body() dto: SuspendUserDto, @Req() req: any) {
    return this.svc.suspendUser(id, req.user.sub, dto.reason);
  }

  @Post("users/:id/unsuspend")
  @ApiOperation({ summary: "Unsuspend a user account" })
  unsuspend(@Param("id") id: string, @Req() req: any) {
    return this.svc.unsuspendUser(id, req.user.sub);
  }

  @Patch("users/:id/role")
  @ApiOperation({ summary: "Update user role" })
  updateRole(@Param("id") id: string, @Body() dto: UpdateUserRoleDto, @Req() req: any) {
    return this.svc.updateUserRole(id, dto.role, req.user.sub);
  }

  // Transactions
  @Get("transactions")
  @ApiOperation({ summary: "List all transactions" })
  @ApiQuery({ name: "chain",  required: false })
  @ApiQuery({ name: "status", required: false })
  transactions(
    @Query("page",  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("chain")  chain?:  string,
    @Query("status") status?: string,
  ) { return this.svc.getTransactions(page, limit, chain, status); }

  // Bridge
  @Get("bridge-transfers")
  @ApiOperation({ summary: "Monitor bridge transfers" })
  @ApiQuery({ name: "status", required: false })
  bridgeTransfers(
    @Query("page",  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("status") status?: string,
  ) { return this.svc.getBridgeTransfers(page, limit, status); }

  // System
  @Get("stats")
  @ApiOperation({ summary: "System-wide statistics" })
  stats() { return this.svc.getSystemStats(); }

  // Audit
  @Get("audit-logs")
  @ApiOperation({ summary: "View audit logs" })
  @ApiQuery({ name: "userId", required: false })
  @ApiQuery({ name: "action", required: false })
  auditLogs(
    @Query("page",   new DefaultValuePipe(1),   ParseIntPipe) page:  number,
    @Query("limit",  new DefaultValuePipe(100),  ParseIntPipe) limit: number,
    @Query("userId") userId?: string,
    @Query("action") action?: string,
  ) { return this.svc.getAuditLogs(page, limit, userId, action); }
}
