import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EventStatus } from '../common/enums/event-status.enum';
import { Role } from '../common/enums/role.enums';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateTicketTierDto } from './dto/create-ticket-tier.dto';
import { FilterEventsDto } from './dto/filter-events.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { Event } from './entities/event.entity';
import { TicketTier } from './entities/ticket-tier.entity';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(TicketTier)
    private readonly ticketTierRepository: Repository<TicketTier>,
  ) {}

  async create(organizerId: string, dto: CreateEventDto): Promise<Event> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate <= new Date()) {
      throw new BadRequestException('Start date must be in the future');
    }

    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const event = this.eventRepository.create({
      ...dto,
      startDate,
      endDate,
      organizerId,
      ticketTiers: dto.ticketTiers.map((tier) => ({
        ...tier,
        availableQuantity: tier.totalQuantity,
      })),
    });

    return this.eventRepository.save(event);
  }

  async findAll(filter: FilterEventsDto) {
    const {
      search,
      city,
      category,
      fromDate,
      toDate,
      page = 1,
      limit = 10,
    } = filter;

    const query = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.ticketTiers', 'tier')
      .leftJoin('event.organizer', 'organizer')
      .addSelect(['organizer.id', 'organizer.fullName', 'organizer.email'])
      .where('event.status = :status', { status: EventStatus.PUBLISHED });

    if (search) {
      query.andWhere(
        '(event.title ILIKE :search OR event.description ILIKE :search OR event.venue ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (city) {
      query.andWhere('LOWER(event.city) = LOWER(:city)', { city });
    }

    if (category) {
      query.andWhere('LOWER(event.category) = LOWER(:category)', { category });
    }

    if (fromDate) {
      query.andWhere('event.startDate >= :fromDate', {
        fromDate: new Date(fromDate),
      });
    }

    if (toDate) {
      query.andWhere('event.startDate <= :toDate', {
        toDate: new Date(toDate),
      });
    }

    query
      .orderBy('event.startDate', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await query.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findMyEvents(organizerId: string): Promise<Event[]> {
    return this.eventRepository.find({
      where: { organizerId },
      relations: {'ticketTiers': true},
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Event> {
    const event = await this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.ticketTiers', 'tier')
      .leftJoin('event.organizer', 'organizer')
      .addSelect(['organizer.id', 'organizer.fullName', 'organizer.email'])
      .where('event.id = :id', { id })
      .getOne();

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async update(
    id: string,
    user: JwtPayload,
    dto: UpdateEventDto,
  ): Promise<Event> {
    const event = await this.findOne(id);
    this.verifyOwnership(event, user);

    const effectiveStart = dto.startDate
      ? new Date(dto.startDate)
      : event.startDate;
    const effectiveEnd = dto.endDate ? new Date(dto.endDate) : event.endDate;

    if (effectiveEnd <= effectiveStart) {
      throw new BadRequestException('End date must be after start date');
    }

    Object.assign(event, {
      ...dto,
      ...(dto.startDate && { startDate: effectiveStart }),
      ...(dto.endDate && { endDate: effectiveEnd }),
    });

    return this.eventRepository.save(event);
  }

  async publish(id: string, user: JwtPayload): Promise<Event> {
    const event = await this.findOne(id);
    this.verifyOwnership(event, user);

    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Cannot publish a cancelled event');
    }

    if (!event.ticketTiers || event.ticketTiers.length === 0) {
      throw new BadRequestException(
        'Event must have at least one ticket tier before publishing',
      );
    }

    event.status = EventStatus.PUBLISHED;
    return this.eventRepository.save(event);
  }

  async cancel(id: string, user: JwtPayload): Promise<Event> {
    const event = await this.findOne(id);
    this.verifyOwnership(event, user);

    event.status = EventStatus.CANCELLED;
    return this.eventRepository.save(event);
  }

  async addTicketTier(
    eventId: string,
    user: JwtPayload,
    dto: CreateTicketTierDto,
  ): Promise<TicketTier> {
    const event = await this.findOne(eventId);
    this.verifyOwnership(event, user);

    const tier = this.ticketTierRepository.create({
      ...dto,
      eventId: event.id,
      availableQuantity: dto.totalQuantity,
    });

    return this.ticketTierRepository.save(tier);
  }

  private verifyOwnership(event: Event, user: JwtPayload): void {
    if (user.role !== Role.ADMIN && event.organizerId !== user.sub) {
      throw new ForbiddenException(
        'You do not have permission to modify this event',
      );
    }
  }
}
