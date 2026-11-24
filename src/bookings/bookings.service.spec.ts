import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { EventStatus } from '../common/enums/event-status.enum';
import { Role } from '../common/enums/role.enums';
import { Event } from '../events/entities/event.entity';
import { TicketTier } from '../events/entities/ticket-tier.entity';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

describe('BookingsService', () => {
  let bookingsService: BookingsService;
  let bookingsQueue: jest.Mocked<Queue>;
  let dataSource: { transaction: jest.Mock };

  const ownerUser: JwtPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    role: Role.USER,
  };

  const otherUser: JwtPayload = {
    sub: 'user-2',
    email: 'other@example.com',
    role: Role.USER,
  };

  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const createManagerMock = (options: {
    tier?: TicketTier | null;
    event?: Event | null;
    booking?: Booking | null;
  }) => {
    const bookingQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(options.booking ?? null),
    };
    const tierQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(options.tier ?? null),
    };

    const manager = {
      createQueryBuilder: jest.fn((entity: unknown) => {
        if (entity === TicketTier) return tierQb;
        if (entity === Booking) return bookingQb;
        throw new Error('Unexpected entity in createQueryBuilder');
      }),
      findOne: jest.fn().mockResolvedValue(options.event ?? null),
      create: jest.fn((_entity: unknown, payload: Partial<Booking>) => ({
        id: 'booking-1',
        ...payload,
      })),
      save: jest.fn(async (entity: unknown) => entity),
    };

    return { manager, tierQb, bookingQb };
  };

  beforeEach(async () => {
    dataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: getRepositoryToken(Booking),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          } as Partial<Repository<Booking>>,
        },
        {
          provide: getRepositoryToken(Event),
          useValue: {
            findOne: jest.fn(),
          } as Partial<Repository<Event>>,
        },
        {
          provide: getQueueToken('bookings'),
          useValue: {
            add: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    bookingsService = module.get<BookingsService>(BookingsService);
    bookingsQueue = module.get(getQueueToken('bookings'));
  });

  describe('create', () => {
    it('should reserve tickets with pessimistic_write lock, save booking, and schedule expiration job', async () => {
      const tier = {
        id: 'tier-1',
        eventId: 'event-1',
        price: 100,
        totalQuantity: 10,
        availableQuantity: 5,
      } as TicketTier;

      const event = {
        id: 'event-1',
        status: EventStatus.PUBLISHED,
        startDate: futureDate,
      } as Event;

      const { manager, tierQb } = createManagerMock({ tier, event });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      const result = await bookingsService.create(ownerUser.sub, {
        ticketTierId: 'tier-1',
        quantity: 2,
      });

      expect(tierQb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(tier.availableQuantity).toBe(3);
      expect(result.status).toBe(BookingStatus.PENDING);
      expect(result.totalAmount).toBe(200);
      expect(bookingsQueue.add).toHaveBeenCalledWith(
        'expire-booking',
        { bookingId: result.id },
        expect.objectContaining({
          delay: 10 * 60 * 1000,
          removeOnComplete: true,
          removeOnFail: true,
        }),
      );
    });

    it('should throw BadRequestException (400) when requested quantity exceeds availableQuantity', async () => {
      const tier = {
        id: 'tier-1',
        eventId: 'event-1',
        price: 100,
        totalQuantity: 10,
        availableQuantity: 1,
      } as TicketTier;

      const event = {
        id: 'event-1',
        status: EventStatus.PUBLISHED,
        startDate: futureDate,
      } as Event;

      const { manager } = createManagerMock({ tier, event });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.create(ownerUser.sub, {
          ticketTierId: 'tier-1',
          quantity: 2,
        }),
      ).rejects.toThrow(
        new BadRequestException('Only 1 ticket(s) remaining for this tier'),
      );

      expect(bookingsQueue.add).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException (404) when ticket tier does not exist', async () => {
      const { manager } = createManagerMock({ tier: null });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.create(ownerUser.sub, {
          ticketTierId: 'missing-tier',
          quantity: 1,
        }),
      ).rejects.toThrow(new NotFoundException('Ticket tier not found'));
    });

    it('should throw BadRequestException (400) when event is not published', async () => {
      const tier = {
        id: 'tier-1',
        eventId: 'event-1',
        availableQuantity: 5,
      } as TicketTier;
      const event = {
        id: 'event-1',
        status: EventStatus.DRAFT,
        startDate: futureDate,
      } as Event;

      const { manager } = createManagerMock({ tier, event });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.create(ownerUser.sub, {
          ticketTierId: 'tier-1',
          quantity: 1,
        }),
      ).rejects.toThrow(
        new BadRequestException('This event is not open for ticket bookings'),
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a PENDING booking and restore tier availableQuantity', async () => {
      const booking = {
        id: 'booking-1',
        userId: ownerUser.sub,
        eventId: 'event-1',
        ticketTierId: 'tier-1',
        quantity: 2,
        status: BookingStatus.PENDING,
      } as Booking;

      const tier = {
        id: 'tier-1',
        availableQuantity: 3,
      } as TicketTier;

      const event = {
        id: 'event-1',
        startDate: futureDate,
      } as Event;

      const { manager } = createManagerMock({ booking, tier, event });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      const result = await bookingsService.cancel('booking-1', ownerUser);

      expect(tier.availableQuantity).toBe(5);
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });

    it('should reject cancellation if booking is already CANCELLED', async () => {
      const booking = {
        id: 'booking-1',
        userId: ownerUser.sub,
        status: BookingStatus.CANCELLED,
      } as Booking;

      const { manager } = createManagerMock({ booking });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.cancel('booking-1', ownerUser),
      ).rejects.toThrow(
        new BadRequestException('Booking is already cancelled'),
      );
    });

    it('should reject cancellation if booking is already EXPIRED', async () => {
      const booking = {
        id: 'booking-1',
        userId: ownerUser.sub,
        status: BookingStatus.EXPIRED,
      } as Booking;

      const { manager } = createManagerMock({ booking });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.cancel('booking-1', ownerUser),
      ).rejects.toThrow(new BadRequestException('Booking is already expired'));
    });

    it('should reject cancellation after the event has started', async () => {
      const booking = {
        id: 'booking-1',
        userId: ownerUser.sub,
        eventId: 'event-1',
        status: BookingStatus.CONFIRMED,
      } as Booking;

      const event = {
        id: 'event-1',
        startDate: new Date(Date.now() - 60_000),
      } as Event;

      const { manager } = createManagerMock({ booking, event });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.cancel('booking-1', ownerUser),
      ).rejects.toThrow(
        new BadRequestException(
          'Cannot cancel a booking after the event has started',
        ),
      );
    });

    it('should throw ForbiddenException (403) when non-owner non-admin attempts to cancel', async () => {
      const booking = {
        id: 'booking-1',
        userId: ownerUser.sub,
        status: BookingStatus.PENDING,
      } as Booking;

      const { manager } = createManagerMock({ booking });
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      await expect(
        bookingsService.cancel('booking-1', otherUser),
      ).rejects.toThrow(
        new ForbiddenException(
          'You do not have permission to cancel this booking',
        ),
      );
    });
  });
});
