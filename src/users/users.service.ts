import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Role } from '../common/enums/role.enums';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    if (userData.email) {
      const existing = await this.findByEmail(userData.email);
      if (existing) {
        throw new ConflictException('Email is already registered');
      }
    }

    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByEmail(
    email: string,
    includeSensitive = false,
  ): Promise<User | null> {
    if (!includeSensitive) {
      return this.usersRepository.findOne({ where: { email } });
    }

    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.hashedRefreshToken'])
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { googleId } });
  }

  async updateRefreshToken(
    userId: string,
    hashedRefreshToken: string | null,
  ): Promise<void> {
    await this.usersRepository.update(userId, { hashedRefreshToken });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.findByIdOrFail(userId);
    Object.assign(user, dto);
    return this.usersRepository.save(user);
  }

  async updateRole(userId: string, role: Role): Promise<User> {
    const user = await this.findByIdOrFail(userId);
    user.role = role;
    return this.usersRepository.save(user);
  }
}