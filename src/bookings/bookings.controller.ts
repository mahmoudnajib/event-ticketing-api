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
import {
  ApiStandardErrorResponse,
  ApiStandardResponse,
} from '../common/swagger/api-response.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FilterBookingsDto } from './dto/filter-bookings.dto';
import { Booking } from './entities/booking.entity';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiStandardErrorResponse(401, 'Unauthorized')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Reserve tickets (holds inventory for 10 minutes until payment)',
  })
  @ApiStandardResponse(Booking, { status: 201, description: 'Booking reserved' })
  @ApiStandardErrorResponse(400, 'Insufficient inventory or invalid request')
  @ApiStandardErrorResponse(404, 'Ticket tier not found')
  create(
    @CurrentUser('sub') userId: string,
    @Body() createBookingDto: CreateBookingDto,
  ) {
    return this.bookingsService.create(userId, createBookingDto);
  }

  @Get('my-bookings')
  @ApiOperation({ summary: 'List current user bookings with pagination' })
  @ApiStandardResponse(Booking, {
    status: 200,
    description: 'Paginated user bookings',
    paginated: true,
  })
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
  @ApiStandardResponse(Booking, {
    status: 200,
    description: 'Event bookings',
    isArray: true,
  })
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Event not found')
  findEventBookings(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.findEventBookings(eventId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking details and ticket code by ID' })
  @ApiStandardResponse(Booking, { status: 200, description: 'Booking details' })
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Booking not found')
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
  @ApiStandardResponse(Booking, { status: 200, description: 'Booking cancelled' })
  @ApiStandardErrorResponse(400, 'Booking cannot be cancelled')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Booking not found')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.cancel(id, user);
  }
}
