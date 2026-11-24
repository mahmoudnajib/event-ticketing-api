import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enums';
import {
  ApiStandardErrorResponse,
  ApiStandardResponse,
} from '../common/swagger/api-response.decorator';
import { User } from './entities/user.entity';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiStandardErrorResponse(401, 'Unauthorized')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current logged-in user profile' })
  @ApiStandardResponse(User, { status: 200, description: 'Current user profile' })
  getMe(@CurrentUser('sub') userId: string) {
    return this.usersService.findByIdOrFail(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current logged-in user profile' })
  @ApiStandardResponse(User, { status: 200, description: 'Updated user profile' })
  @ApiStandardErrorResponse(400, 'Validation failed')
  updateMe(
    @CurrentUser('sub') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get any user by ID (Admin only)' })
  @ApiStandardResponse(User, { status: 200, description: 'User details' })
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'User not found')
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findByIdOrFail(id);
  }
}