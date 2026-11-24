import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enums';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FilterBookingsDto } from './dto/filter-bookings.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Reserve tickets (holds inventory for 10 minutes until payment)',
  })
  create(
    @CurrentUser('sub') userId: string,
    @Body() createBookingDto: CreateBookingDto,
  ) {
    return this.bookingsService.create(userId, createBookingDto);
  }

  @Get('my-bookings')
  @ApiOperation({ summary: 'List current user bookings with pagination' })
  findMyBookings(
    @CurrentUser('sub') userId: string,
    @Query() filterDto: FilterBookingsDto,
  ) {
    return this.bookingsService.findMyBookings(userId, filterDto);
  }

  @Get('event/:eventId')
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiOperation({
    summary: 'List all bookings for a specific event (Event Owner/Admin)',
  })
  findEventBookings(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.findEventBookings(eventId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking details and ticket code by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.findOne(id, user);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a booking and release tickets back to inventory',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.cancel(id, user);
  }
}
