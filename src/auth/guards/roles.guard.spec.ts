import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enums';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  const createContext = (user?: { role?: Role }): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('should allow access when no roles metadata is defined', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createContext({ role: Role.USER });

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });

  it('should allow access when roles metadata is empty array', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    expect(guard.canActivate(createContext({ role: Role.USER }))).toBe(true);
  });

  it('should allow access when user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ORGANIZER, Role.ADMIN]);

    expect(guard.canActivate(createContext({ role: Role.ORGANIZER }))).toBe(
      true,
    );
    expect(guard.canActivate(createContext({ role: Role.ADMIN }))).toBe(true);
  });

  it('should deny access when user lacks the required role or is absent', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ORGANIZER, Role.ADMIN]);

    expect(guard.canActivate(createContext({ role: Role.USER }))).toBe(false);
    expect(guard.canActivate(createContext(undefined))).toBe(false);
  });
});
