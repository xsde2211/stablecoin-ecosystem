import {
  Controller, Post, Body, Req, Get,
  HttpCode, HttpStatus, UseGuards, Res, Header,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response }        from 'express';
import { AuthService }     from './auth.service';
import { RegisterDto }     from './dto/register.dto';
import { LoginDto }        from './dto/login.dto';
import { RefreshDto }      from './dto/refresh.dto';
import { JwtAuthGuard }    from './jwt-auth.guard';
import { JwtRefreshGuard } from './jwt-refresh.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
    return this.auth.login(dto, ip);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get new access token using refresh token' })
  refresh(@Req() req: any) {
    return this.auth.refresh(req.user.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate tokens' })
  logout(@Req() req: any, @Body() dto: RefreshDto) {
    return this.auth.logout(req.user.sub, dto.refreshToken);
  }

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA secret and QR code URL' })
  setup2FA(@Req() req: any) {
    return this.auth.setup2FA(req.user.sub);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify and activate 2FA' })
  verify2FA(@Req() req: any, @Body('token') token: string) {
    return this.auth.verify2FA(req.user.sub, token);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable 2FA' })
  disable2FA(@Req() req: any, @Body('token') token: string) {
    return this.auth.disable2FA(req.user.sub, token);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change account password' })
  changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.auth.changePassword(req.user.sub, body.currentPassword, body.newPassword);
  }

  /**
   * GET /auth/me
   *
   * Uses @Res() + res.status(200).json() to explicitly control the HTTP
   * response code and prevent NestJS/Express from generating an ETag and
   * responding with 304 Not Modified (which has no body and breaks axios).
   *
   * Also sets Cache-Control / Pragma headers to tell any intermediary
   * proxy (including our gateway) not to cache this response.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async me(@Req() req: any, @Res() res: Response) {
    // Fetch full user from DB (not just the JWT payload) so the mobile app
    // gets role, kycStatus, isActive, twoFaEnabled, etc.
    const user = await this.auth.getMe(req.user.sub);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // Explicitly remove ETag — Express sets it automatically for small JSON,
    // removing it prevents any 304 from ever being triggered.
    res.removeHeader('ETag');

    // Force HTTP 200 — never 304, never 304-via-caching
    return res.status(200).json(user);
  }
}
