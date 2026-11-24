import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { PaymentsService } from './payments.service';

const mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockStripe),
}));

describe('PaymentsService', () => {
  let paymentsService: PaymentsService;
  let bookingRepository: jest.Mocked<Repository<Booking>>;
  let dataSource: { transaction: jest.Mock };

  const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);

  beforeEach(async () => {
    dataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'STRIPE_SECRET_KEY') return 'sk_test_mock';
              if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_mock';
              throw new Error(`Missing key: ${key}`);
            }),
          },
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    paymentsService = module.get<PaymentsService>(PaymentsService);
    bookingRepository = module.get(getRepositoryToken(Booking));
    jest.clearAllMocks();
  });

  describe('createPaymentIntent', () => {
    it('should create a Stripe PaymentIntent in cents and save stripePaymentIntentId', async () => {
      const booking = {
        id: 'booking-1',
        userId: 'user-1',
        eventId: 'event-1',
        ticketCode: 'TKT-ABC123',
        totalAmount: 49.99,
        status: BookingStatus.PENDING,
        expiresAt: futureExpiry,
      } as Booking;

      bookingRepository.findOne.mockResolvedValue(booking);
      bookingRepository.save.mockResolvedValue(booking);
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_new_123',
        client_secret: 'pi_new_123_secret',
        currency: 'usd',
      });

      const result = await paymentsService.createPaymentIntent(
        'user-1',
        'booking-1',
      );

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 4999,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          bookingId: 'booking-1',
          userId: 'user-1',
          eventId: 'event-1',
          ticketCode: 'TKT-ABC123',
        },
      });
      expect(booking.stripePaymentIntentId).toBe('pi_new_123');
      expect(bookingRepository.save).toHaveBeenCalledWith(booking);
      expect(result).toEqual({
        paymentIntentId: 'pi_new_123',
        clientSecret: 'pi_new_123_secret',
        amount: 49.99,
        currency: 'usd',
      });
    });

    it('should reuse an existing incomplete PaymentIntent on the booking', async () => {
      const booking = {
        id: 'booking-1',
        userId: 'user-1',
        totalAmount: 100,
        status: BookingStatus.PENDING,
        expiresAt: futureExpiry,
        stripePaymentIntentId: 'pi_existing_123',
      } as Booking;

      bookingRepository.findOne.mockResolvedValue(booking);
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing_123',
        client_secret: 'pi_existing_secret',
        status: 'requires_payment_method',
        currency: 'usd',
      });

      const result = await paymentsService.createPaymentIntent(
        'user-1',
        'booking-1',
      );

      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        paymentIntentId: 'pi_existing_123',
        clientSecret: 'pi_existing_secret',
        amount: 100,
        currency: 'usd',
      });
    });

    it('should throw NotFoundException (404) if booking does not exist', async () => {
      bookingRepository.findOne.mockResolvedValue(null);

      await expect(
        paymentsService.createPaymentIntent('user-1', 'missing-booking'),
      ).rejects.toThrow(new NotFoundException('Booking not found'));
    });

    it('should throw ForbiddenException (403) if booking belongs to another user', async () => {
      bookingRepository.findOne.mockResolvedValue({
        id: 'booking-1',
        userId: 'other-user',
        status: BookingStatus.PENDING,
        expiresAt: futureExpiry,
      } as Booking);

      await expect(
        paymentsService.createPaymentIntent('user-1', 'booking-1'),
      ).rejects.toThrow(
        new ForbiddenException('You do not have access to this booking'),
      );
    });

    it('should throw BadRequestException (400) if booking is not PENDING', async () => {
      bookingRepository.findOne.mockResolvedValue({
        id: 'booking-1',
        userId: 'user-1',
        status: BookingStatus.CONFIRMED,
        expiresAt: futureExpiry,
      } as Booking);

      await expect(
        paymentsService.createPaymentIntent('user-1', 'booking-1'),
      ).rejects.toThrow(
        new BadRequestException(
          'Cannot pay for a booking with status CONFIRMED',
        ),
      );
    });
  });

  describe('handleWebhook', () => {
    it('should throw BadRequestException (400) when webhook signature verification fails', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      await expect(
        paymentsService.handleWebhook(Buffer.from('{}'), 'bad_signature'),
      ).rejects.toThrow(
        new BadRequestException(
          'Webhook Error: No signatures found matching the expected signature',
        ),
      );
    });

    it('should confirm a PENDING booking on payment_intent.succeeded', async () => {
      const booking = {
        id: 'booking-1',
        status: BookingStatus.PENDING,
        stripePaymentIntentId: undefined,
      } as Booking;

      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(booking),
      };
      const manager = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        save: jest.fn(async (b: Booking) => b),
      };
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_succeeded_123',
            metadata: { bookingId: 'booking-1' },
          },
        },
      });

      const result = await paymentsService.handleWebhook(
        Buffer.from('payload'),
        'valid_sig',
      );

      expect(result).toEqual({ received: true });
      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(booking.stripePaymentIntentId).toBe('pi_succeeded_123');
      expect(manager.save).toHaveBeenCalledWith(booking);
    });

    it('should be idempotent when booking is already CONFIRMED', async () => {
      const booking = {
        id: 'booking-1',
        status: BookingStatus.CONFIRMED,
        stripePaymentIntentId: 'pi_succeeded_123',
      } as Booking;

      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(booking),
      };
      const manager = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        save: jest.fn(),
      };
      dataSource.transaction.mockImplementation((cb) => cb(manager));

      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_succeeded_123',
            metadata: { bookingId: 'booking-1' },
          },
        },
      });

      const result = await paymentsService.handleWebhook(
        Buffer.from('payload'),
        'valid_sig',
      );

      expect(result).toEqual({ received: true });
      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
