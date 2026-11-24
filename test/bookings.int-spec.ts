import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { BookingsProcessor, ExpireBookingJobData } from '../src/bookings/bookings.processor';
import { BookingsService } from '../src/bookings/bookings.service';
import { Booking } from '../src/bookings/entities/booking.entity';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { EventStatus } from '../src/common/enums/event-status.enum';
import { Role } from '../src/common/enums/role.enums';
import { getDatabaseConfig } from '../src/config/database.config';
import { Event } from '../src/events/entities/event.entity';
import { TicketTier } from '../src/events/entities/ticket-tier.entity';
import { User } from '../src/users/entities/user.entity';

describe('BookingsService (Integration)', () => {
  let moduleRef: TestingModule;
  let bookingsService: BookingsService;
  let bookingsProcessor: BookingsProcessor;
  let dataSource: DataSource;
  let bookingsQueue: Queue<ExpireBookingJobData>;

  let organizer: User;
  let customer: User;
  let event: Event;
  let tier: TicketTier;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: getDatabaseConfig,
        }),
        TypeOrmModule.forFeature([User, Event, TicketTier, Booking]),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            connection: {
              host: configService.get<string>('REDIS_HOST', 'localhost'),
              port: Number(configService.get<number>('REDIS_PORT', 6379)),
              db: Number(configService.get<number>('REDIS_DB', 1)),
            },
          }),
        }),
        BullModule.registerQueue({
          name: 'bookings',
        }),
      ],
      providers: [BookingsService, BookingsProcessor],
    }).compile();

    bookingsService = moduleRef.get(BookingsService);
    bookingsProcessor = moduleRef.get(BookingsProcessor);
    dataSource = moduleRef.get(DataSource);
    bookingsQueue = moduleRef.get<Queue<ExpireBookingJobData>>(
      getQueueToken('bookings'),
    );
  });

  beforeEach(async () => {
    await bookingsQueue.obliterate({ force: true });
    await dataSource.query(
      'TRUNCATE TABLE bookings, ticket_tiers, events, users RESTART IDENTITY CASCADE',
    );

    const userRepo = dataSource.getRepository(User);
    organizer = await userRepo.save(
      userRepo.create({
        email: 'organizer.int@example.com',
        fullName: 'Integration Organizer',
        role: Role.ORGANIZER,
      }),
    );
    customer = await userRepo.save(
      userRepo.create({
        email: 'customer.int@example.com',
        fullName: 'Integration Customer',
        role: Role.USER,
      }),
    );

    const eventRepo = dataSource.getRepository(Event);
    const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    event = await eventRepo.save(
      eventRepo.create({
        title: 'Integration Concert',
        description: 'Live concert for integration testing',
        venue: 'Test Arena',
        city: 'Cairo',
        category: 'Music',
        startDate: futureStart,
        endDate: futureEnd,
        status: EventStatus.PUBLISHED,
        organizerId: organizer.id,
        ticketTiers: [
          {
            name: 'General Admission',
            price: 50,
            totalQuantity: 5,
            availableQuantity: 5,
          } as TicketTier,
        ],
      }),
    );

    tier = event.ticketTiers[0];
  });

  afterAll(async () => {
    if (bookingsQueue) {
      await bookingsQueue.obliterate({ force: true });
    }
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'TRUNCATE TABLE bookings, ticket_tiers, events, users RESTART IDENTITY CASCADE',
      );
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('should reserve tickets in PostgreSQL and schedule a delayed expiration job in Redis', async () => {
    const booking = await bookingsService.create(customer.id, {
      ticketTierId: tier.id,
      quantity: 2,
    });

    expect(booking.id).toBeDefined();
    expect(booking.status).toBe(BookingStatus.PENDING);
    expect(booking.totalAmount).toBe(100);
    expect(booking.ticketCode).toMatch(/^TKT-/);

    const updatedTier = await dataSource
      .getRepository(TicketTier)
      .findOneByOrFail({ id: tier.id });
    expect(updatedTier.availableQuantity).toBe(3);

    const delayedJobs = await bookingsQueue.getDelayed();
    expect(delayedJobs).toHaveLength(1);
    expect(delayedJobs[0].name).toBe('expire-booking');
    expect(delayedJobs[0].data).toEqual({ bookingId: booking.id });
  });

  it('should prevent overselling under concurrent booking requests using pessimistic locking', async () => {
    const tierRepo = dataSource.getRepository(TicketTier);
    await tierRepo.update({ id: tier.id }, { availableQuantity: 2 });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        bookingsService.create(customer.id, {
          ticketTierId: tier.id,
          quantity: 1,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    rejected.forEach((r) => {
      expect(r.reason).toBeInstanceOf(BadRequestException);
    });

    const finalTier = await tierRepo.findOneByOrFail({ id: tier.id });
    expect(finalTier.availableQuantity).toBe(0);
  });

  it('should cancel a pending booking and restore ticket inventory', async () => {
    const booking = await bookingsService.create(customer.id, {
      ticketTierId: tier.id,
      quantity: 3,
    });

    const cancelled = await bookingsService.cancel(booking.id, {
      sub: customer.id,
      email: customer.email,
      role: customer.role,
    });

    expect(cancelled.status).toBe(BookingStatus.CANCELLED);

    const updatedTier = await dataSource
      .getRepository(TicketTier)
      .findOneByOrFail({ id: tier.id });
    expect(updatedTier.availableQuantity).toBe(5);
  });

  it('should return paginated { data, meta } from findMyBookings', async () => {
    await bookingsService.create(customer.id, {
      ticketTierId: tier.id,
      quantity: 1,
    });
    await bookingsService.create(customer.id, {
      ticketTierId: tier.id,
      quantity: 1,
    });

    const result = await bookingsService.findMyBookings(customer.id, {
      page: 1,
      limit: 1,
    });

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      limit: 1,
      totalPages: 2,
    });
  });

  it('should expire a pending booking and release tickets when processor runs', async () => {
    const booking = await bookingsService.create(customer.id, {
      ticketTierId: tier.id,
      quantity: 2,
    });

    await bookingsProcessor.process({
      name: 'expire-booking',
      data: { bookingId: booking.id },
    } as Job<ExpireBookingJobData>);

    const expiredBooking = await dataSource
      .getRepository(Booking)
      .findOneByOrFail({ id: booking.id });
    expect(expiredBooking.status).toBe(BookingStatus.EXPIRED);

    const restoredTier = await dataSource
      .getRepository(TicketTier)
      .findOneByOrFail({ id: tier.id });
    expect(restoredTier.availableQuantity).toBe(5);
  });
});
