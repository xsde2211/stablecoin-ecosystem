import {
  Controller, Get, Post, Patch, Param, Body, Req,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }       from '@nestjs/passport';
import { AdminService }    from './admin.service';
import { UpdateRoleDto }   from './dto/update-role.dto';
import { SuspendUserDto }  from './dto/suspend-user.dto';
import { GrantRoleDto }    from './dto/grant-role.dto';
import { SuperAdminGuard } from './super-admin.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('admin')
export class AdminController {
  constructor(private svc: AdminService) {}

  // ─── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary:'List all users — searchable, filterable by KYC status' })
  @ApiQuery({ name:'page',      required:false, type:Number })
  @ApiQuery({ name:'limit',     required:false, type:Number })
  @ApiQuery({ name:'search',    required:false, description:'Search by email or phone' })
  @ApiQuery({ name:'kycStatus', required:false, enum:['NOT_SUBMITTED','SUBMITTED','APPROVED','REJECTED'] })
  users(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search')    search?:    string,
    @Query('kycStatus') kycStatus?: string,
  ) { return this.svc.getUsers(page, limit, search, kycStatus); }

  @Get('users/:id')
  @ApiOperation({ summary:'Get single user — wallets, KYC history, transaction count, fraud flags' })
  user(@Param('id') id: string) { return this.svc.getUser(id); }

  @Post('users/:id/suspend')
  @ApiOperation({ summary:'Suspend user account' })
  suspend(@Param('id') id: string, @Body() dto: SuspendUserDto, @Req() req: any) {
    return this.svc.suspendUser(id, dto, req.user.sub);
  }

  @Post('users/:id/unsuspend')
  @ApiOperation({ summary:'Reactivate suspended user' })
  unsuspend(@Param('id') id: string, @Req() req: any) {
    return this.svc.unsuspendUser(id, req.user.sub);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary:'Change user role — USER/MERCHANT/COMPLIANCE/ADMIN/SUPERADMIN' })
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Req() req: any) {
    return this.svc.updateRole(id, dto, req.user.sub);
  }

  // ─── Transactions ────────────────────────────────────────────────────────────

  @Get('transactions')
  @ApiOperation({ summary:'List all transactions — filterable by chain/status' })
  @ApiQuery({ name:'page',   required:false, type:Number })
  @ApiQuery({ name:'limit',  required:false, type:Number })
  @ApiQuery({ name:'chain',  required:false })
  @ApiQuery({ name:'status', required:false })
  transactions(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('chain')  chain?:  string,
    @Query('status') status?: string,
  ) { return this.svc.getTransactions(page, limit, chain, status); }

  // ─── Bridge transfers ─────────────────────────────────────────────────────────

  @Get('bridge-transfers')
  @ApiOperation({ summary:'List all bridge transfers — filterable by status' })
  @ApiQuery({ name:'page',   required:false, type:Number })
  @ApiQuery({ name:'limit',  required:false, type:Number })
  @ApiQuery({ name:'status', required:false, enum:['PENDING','LOCKED','COMPLETED','FAILED'] })
  bridgeTransfers(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) { return this.svc.getBridgeTransfers(page, limit, status); }

  // ─── System stats ─────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary:'System-wide stats — users, KYC, transactions, fraud flags' })
  stats() { return this.svc.getStats(); }

  // ─── Audit logs ────────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary:'View audit log — filterable by user or action type' })
  @ApiQuery({ name:'page',   required:false, type:Number })
  @ApiQuery({ name:'limit',  required:false, type:Number })
  @ApiQuery({ name:'userId', required:false })
  @ApiQuery({ name:'action', required:false })
  auditLogs(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
  ) { return this.svc.getAuditLogs(page, limit, userId, action); }

  // ─── System roles / signers ──────────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({ summary:'Every on-chain role holder (by address only) + human staff accounts — for the Mint/Burn testing page' })
  roles() { return this.svc.getSystemRoles(); }

  // ─── On-chain role management — SUPER_ADMIN only ───────────────────────────────

  @Get('roles/registry')
  @ApiOperation({ summary:'List every manageable contract and its roles (for building a grant/revoke UI)' })
  roleRegistry() { return this.svc.getRoleRegistry(); }

  @Get('roles/check')
  @ApiOperation({ summary:'Check whether an address currently holds a given on-chain role' })
  @ApiQuery({ name:'chain', required:true })
  @ApiQuery({ name:'contract', required:true })
  @ApiQuery({ name:'role', required:true })
  @ApiQuery({ name:'address', required:true })
  checkRole(
    @Query('chain') chain: string, @Query('contract') contract: string,
    @Query('role') role: string, @Query('address') address: string,
  ) { return this.svc.checkOnChainRole(chain, contract, role, address); }

  @Post('roles/grant')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary:'Grant an on-chain role to any address — SUPER_ADMIN only' })
  grantRole(@Body() dto: GrantRoleDto, @Req() req: any) {
    return this.svc.grantOnChainRole(dto.chain, dto.contract, dto.role, dto.address, req.user.sub);
  }

  @Post('roles/revoke')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary:'Revoke an on-chain role from any address — SUPER_ADMIN only' })
  revokeRole(@Body() dto: GrantRoleDto, @Req() req: any) {
    return this.svc.revokeOnChainRole(dto.chain, dto.contract, dto.role, dto.address, req.user.sub);
  }

  @Post('users/:id/grant-all-roles')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary:"Grant every on-chain role, on every contract/chain, to this user's wallets — SUPER_ADMIN only. Runs in the background." })
  grantAllRoles(@Param('id') id: string, @Req() req: any) {
    this.svc.grantAllRolesToUser(id, req.user.sub).catch(() => {});
    return { message: 'Granting all roles in the background — check the audit log for progress.' };
  }
}