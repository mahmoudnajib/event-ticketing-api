import { Role } from '../../common/enums/role.enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}