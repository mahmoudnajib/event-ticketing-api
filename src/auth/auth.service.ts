import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.usersService.create({
      fullName: dto.fullName,
      email: dto.email.toLowerCase(),
      password: hashedPassword,
    });

    const tokens = await this.generateTokens(user);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(
      dto.email.toLowerCase(),
      true,
    );

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens(user);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refreshTokens(userId: string, incomingRefreshToken: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const userWithSecrets = await this.usersService.findByEmail(
      user.email,
      true,
    );

    if (!userWithSecrets?.hashedRefreshToken) {
      throw new ForbiddenException('Access denied');
    }

    const incomingHash = this.hashToken(incomingRefreshToken);
    if (incomingHash !== userWithSecrets.hashedRefreshToken) {
      await this.usersService.updateRefreshToken(user.id, null);
      throw new ForbiddenException('Refresh token reuse detected');
    }

    const tokens = await this.generateTokens(user);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.updateRefreshToken(userId, null);
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessTtl = Number(
      this.configService.get<string>('JWT_ACCESS_TTL', '900'),
    );
    const refreshTtl = Number(
      this.configService.get<string>('JWT_REFRESH_TTL', '604800'),
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshTokenHash(userId: string, refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    await this.usersService.updateRefreshToken(userId, hash);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sanitizeUser(user: User) {
    const { password, hashedRefreshToken, ...safeUser } = user;
    return safeUser;
  }

  async loginWithGoogle(googleProfile: {
    googleId: string;
    email?: string;
    fullName: string;
    avatarUrl?: string;
  }) {
    if (!googleProfile.email) {
      throw new UnauthorizedException('Google account has no email');
    }

    const email = googleProfile.email.toLowerCase();
    let user = await this.usersService.findByGoogleId(googleProfile.googleId);

    if (!user) {
      user = await this.usersService.findByEmail(email);

      if (user) {
        user.googleId = googleProfile.googleId;
        if (!user.avatarUrl && googleProfile.avatarUrl) {
          user.avatarUrl = googleProfile.avatarUrl;
        }
        user = await this.usersService.updateProfile(user.id, {
          avatarUrl: user.avatarUrl,
        });
      } else {
        user = await this.usersService.create({
          email,
          googleId: googleProfile.googleId,
          fullName: googleProfile.fullName,
          avatarUrl: googleProfile.avatarUrl,
        });
      }
    }

    const tokens = await this.generateTokens(user);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }


}