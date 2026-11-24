import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Role } from '../common/enums/role.enums';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser: User = {
    id: 'user-uuid-1',
    email: 'mahmoud@example.com',
    password: 'hashed-password',
    fullName: 'Mahmoud Naguib',
    role: Role.USER,
    hashedRefreshToken: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const hashToken = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            create: jest.fn(),
            findByEmail: jest.fn(),
            findById: jest.fn(),
            findByGoogleId: jest.fn(),
            updateRefreshToken: jest.fn(),
            updateProfile: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'JWT_ACCESS_TTL') return '900';
              if (key === 'JWT_REFRESH_TTL') return '604800';
              return defaultValue;
            }),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
              if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
              throw new Error(`Missing config key: ${key}`);
            }),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user, hash password, issue tokens, and store refresh token hash', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      usersService.create.mockResolvedValue({ ...mockUser });
      jwtService.signAsync
        .mockResolvedValueOnce('access-token-1')
        .mockResolvedValueOnce('refresh-token-1');

      const result = await authService.register({
        fullName: 'Mahmoud Naguib',
        email: 'Mahmoud@Example.com',
        password: 'StrongPassword123!',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('StrongPassword123!', 12);
      expect(usersService.create).toHaveBeenCalledWith({
        fullName: 'Mahmoud Naguib',
        email: 'mahmoud@example.com',
        password: 'hashed-password',
      });
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        hashToken('refresh-token-1'),
      );
      expect(result).toEqual({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          fullName: mockUser.fullName,
          role: mockUser.role,
          createdAt: mockUser.createdAt,
          updatedAt: mockUser.updatedAt,
        },
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
      });
      expect((result.user as any).password).toBeUndefined();
      expect((result.user as any).hashedRefreshToken).toBeUndefined();
    });

    it('should propagate ConflictException (409) when email is already registered', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      usersService.create.mockRejectedValue(
        new ConflictException('Email is already registered'),
      );

      await expect(
        authService.register({
          fullName: 'Mahmoud Naguib',
          email: 'mahmoud@example.com',
          password: 'StrongPassword123!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should authenticate valid credentials and return sanitized user and tokens', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token-login')
        .mockResolvedValueOnce('refresh-token-login');

      const result = await authService.login({
        email: 'Mahmoud@Example.com',
        password: 'StrongPassword123!',
      });

      expect(usersService.findByEmail).toHaveBeenCalledWith(
        'mahmoud@example.com',
        true,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'StrongPassword123!',
        'hashed-password',
      );
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        hashToken('refresh-token-login'),
      );
      expect(result.accessToken).toBe('access-token-login');
      expect(result.refreshToken).toBe('refresh-token-login');
      expect((result.user as any).password).toBeUndefined();
    });

    it('should throw UnauthorizedException (401) when user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'unknown@example.com',
          password: 'StrongPassword123!',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });

    it('should throw UnauthorizedException (401) when password is invalid', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'mahmoud@example.com',
          password: 'WrongPassword123!',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });
  });

  describe('refreshTokens', () => {
    it('should rotate refresh token when incoming token matches stored hash', async () => {
      const oldRefreshToken = 'valid-refresh-token';
      usersService.findById.mockResolvedValue({ ...mockUser });
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: hashToken(oldRefreshToken),
      });
      jwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      const result = await authService.refreshTokens(
        mockUser.id,
        oldRefreshToken,
      );

      expect(usersService.updateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        hashToken('new-refresh-token'),
      );
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should revoke stored token and throw ForbiddenException when token reuse is detected', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser });
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: hashToken('current-valid-refresh-token'),
      });

      await expect(
        authService.refreshTokens(mockUser.id, 'stolen-old-refresh-token'),
      ).rejects.toThrow(new ForbiddenException('Refresh token reuse detected'));

      expect(usersService.updateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        null,
      );
    });

    it('should throw ForbiddenException when user has no stored refresh token', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser });
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: null,
      });

      await expect(
        authService.refreshTokens(mockUser.id, 'any-token'),
      ).rejects.toThrow(new ForbiddenException('Access denied'));
    });
  });

  describe('logout', () => {
    it('should clear stored refresh token hash', async () => {
      await authService.logout(mockUser.id);
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        null,
      );
    });
  });
});
