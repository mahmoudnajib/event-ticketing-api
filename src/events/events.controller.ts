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
import { CreateEventDto } from './dto/create-event.dto';
import { CreateTicketTierDto } from './dto/create-ticket-tier.dto';
import { FilterEventsDto } from './dto/filter-events.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { Event } from './entities/event.entity';
import { TicketTier } from './entities/ticket-tier.entity';
import { EventsService } from './events.service';

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new event with ticket tiers (Organizer/Admin)' })
  @ApiStandardResponse(Event, { status: 201, description: 'Event created' })
  @ApiStandardErrorResponse(400, 'Validation failed')
  @ApiStandardErrorResponse(401, 'Unauthorized')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  create(
    @CurrentUser('sub') organizerId: string,
    @Body() createEventDto: CreateEventDto,
  ) {
    return this.eventsService.create(organizerId, createEventDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all published events with filtering & pagination' })
  @ApiStandardResponse(Event, {
    status: 200,
    description: 'Paginated list of published events',
    paginated: true,
  })
  findAll(@Query() filterDto: FilterEventsDto) {
    return this.eventsService.findAll(filterDto);
  }

  @Get('my-events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all events created by the current organizer' })
  @ApiStandardResponse(Event, {
    status: 200,
    description: 'Organizer events',
    isArray: true,
  })
  @ApiStandardErrorResponse(401, 'Unauthorized')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  findMyEvents(@CurrentUser('sub') organizerId: string) {
    return this.eventsService.findMyEvents(organizerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event details by ID' })
  @ApiStandardResponse(Event, { status: 200, description: 'Event details' })
  @ApiStandardErrorResponse(404, 'Event not found')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update event details (Owner/Admin)' })
  @ApiStandardResponse(Event, { status: 200, description: 'Updated event' })
  @ApiStandardErrorResponse(400, 'Validation failed')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Event not found')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() updateEventDto: UpdateEventDto,
  ) {
    return this.eventsService.update(id, user, updateEventDto);
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a draft event (Owner/Admin)' })
  @ApiStandardResponse(Event, { status: 200, description: 'Published event' })
  @ApiStandardErrorResponse(400, 'Cannot publish event')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Event not found')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.eventsService.publish(id, user);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an event (Owner/Admin)' })
  @ApiStandardResponse(Event, { status: 200, description: 'Cancelled event' })
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Event not found')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.eventsService.cancel(id, user);
  }

  @Post(':id/tiers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a new ticket tier to an existing event (Owner/Admin)' })
  @ApiStandardResponse(TicketTier, { status: 201, description: 'Ticket tier added' })
  @ApiStandardErrorResponse(400, 'Validation failed')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Event not found')
  addTicketTier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() createTicketTierDto: CreateTicketTierDto,
  ) {
    return this.eventsService.addTicketTier(id, user, createTicketTierDto);
  }
}
