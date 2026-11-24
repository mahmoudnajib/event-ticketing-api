import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { EventStatus } from '../common/enums/event-status.enum';
import { Role } from '../common/enums/role.enums';
import { Event } from '../events/entities/event.entity';
import { TicketTier } from '../events/entities/ticket-tier.entity';
import type { ExpireBookingJobData } from './bookings.processor';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FilterBookingsDto } from './dto/filter-bookings.dto';
import { Booking } from './entities/booking.entity';

const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectQueue('bookings')
    private readonly bookingsQueue: Queue<ExpireBookingJobData>,
    private readonly dataSource: DataSource,
  ) {}

  async create(userId: string, dto: CreateBookingDto): Promise<Booking> {
    const savedBooking = await this.dataSource.transaction(async (manager) => {
      // 1. Row-level lock on the ticket tier to prevent overselling
      const tier = await manager
        .createQueryBuilder(TicketTier, 'tier')
        .setLock('pessimistic_write')
        .where('tier.id = :id', { id: dto.ticketTierId })
        .getOne();

      if (!tier) {
        throw new NotFoundException('Ticket tier not found');
      }

      // 2. Validate parent event state
      const event = await manager.findOne(Event, {
        where: { id: tier.eventId },
      });

      if (!event || event.status !== EventStatus.PUBLISHED) {
        throw new BadRequestException(
          'This event is not open for ticket bookings',
        );
      }

      if (new Date(event.startDate) <= new Date()) {
        throw new BadRequestException('Cannot book tickets for a past event');
      }

      // 3. Check availability under lock and deduct inventory
      if (tier.availableQuantity < dto.quantity) {
        throw new BadRequestException(
          `Only ${tier.availableQuantity} ticket(s) remaining for this tier`,
        );
      }

      tier.availableQuantity -= dto.quantity;
      await manager.save(tier);

      // 4. Create pending reservation
      const ticketCode = `TKT-${randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
      const totalAmount = Number((tier.price * dto.quantity).toFixed(2));

      const booking = manager.create(Booking, {
        userId,
        eventId: event.id,
        ticketTierId: tier.id,
        quantity: dto.quantity,
        totalAmount,
        status: BookingStatus.PENDING,
        ticketCode,
        expiresAt,
      });

      return manager.save(booking);
    });

    // 5. Schedule delayed expiration job in Redis after transaction commits
    await this.bookingsQueue.add(
      'expire-booking',
      { bookingId: savedBooking.id },
      {
        delay: RESERVATION_TTL_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    return savedBooking;
  }

  async findMyBookings(userId: string, filter: FilterBookingsDto) {
    const { status, page = 1, limit = 10 } = filter;

    const [data, total] = await this.bookingRepository.findAndCount({
      where: {
        userId,
        ...(status && { status }),
      },
      relations: {
        event: true,
        ticketTier: true,
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

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

  async findOne(id: string, user: JwtPayload): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: {
        event: true,
        ticketTier: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (user.role !== Role.ADMIN && booking.userId !== user.sub) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    return booking;
  }

  async cancel(id: string, user: JwtPayload): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager
        .createQueryBuilder(Booking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :id', { id })
        .getOne();

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (user.role !== Role.ADMIN && booking.userId !== user.sub) {
        throw new ForbiddenException(
          'You do not have permission to cancel this booking',
        );
      }

      if (
        booking.status === BookingStatus.CANCELLED ||
        booking.status === BookingStatus.EXPIRED
      ) {
        throw new BadRequestException(
          `Booking is already ${booking.status.toLowerCase()}`,
        );
      }

      const event = await manager.findOne(Event, {
        where: { id: booking.eventId },
      });

      if (event && new Date(event.startDate) <= new Date()) {
        throw new BadRequestException(
          'Cannot cancel a booking after the event has started',
        );
      }

      // Restore tickets back to inventory
      const tier = await manager
        .createQueryBuilder(TicketTier, 'tier')
        .setLock('pessimistic_write')
        .where('tier.id = :id', { id: booking.ticketTierId })
        .getOne();

      if (tier) {
        tier.availableQuantity += booking.quantity;
        await manager.save(tier);
      }

      booking.status = BookingStatus.CANCELLED;
      return manager.save(booking);
    });
  }

  async findEventBookings(eventId: string, user: JwtPayload): Promise<Booking[]> {
    const event = await this.eventRepository.findOne({ where: { id: eventId } });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (user.role !== Role.ADMIN && event.organizerId !== user.sub) {
      throw new ForbiddenException(
        'You do not have permission to view bookings for this event',
      );
    }

    return this.bookingRepository.find({
      where: { eventId },
      relations: { ticketTier: true },
      order: { createdAt: 'DESC' },
    });
  }
}
