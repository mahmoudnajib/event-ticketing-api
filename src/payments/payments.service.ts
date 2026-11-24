import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingStatus } from '../common/enums/booking-status.enum';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly dataSource: DataSource,
  ) {
    const secretKey = this.configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey);
  }

  async createPaymentIntent(userId: string, bookingId: string) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
      relations: { event: true, ticketTier: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.userId !== userId) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Cannot pay for a booking with status ${booking.status}`,
      );
    }

    if (new Date(booking.expiresAt) <= new Date()) {
      throw new BadRequestException('Booking reservation has expired');
    }

    // Reuse existing PaymentIntent if already created for this pending booking
    if (booking.stripePaymentIntentId) {
      const existingIntent = await this.stripe.paymentIntents.retrieve(
        booking.stripePaymentIntentId,
      );

      if (
        existingIntent.status === 'requires_payment_method' ||
        existingIntent.status === 'requires_confirmation' ||
        existingIntent.status === 'requires_action'
      ) {
        return {
          paymentIntentId: existingIntent.id,
          clientSecret: existingIntent.client_secret,
          amount: booking.totalAmount,
          currency: existingIntent.currency,
        };
      }
    }

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(booking.totalAmount * 100), // Convert to cents
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      metadata: {
        bookingId: booking.id,
        userId: booking.userId,
        eventId: booking.eventId,
        ticketCode: booking.ticketCode,
      },
    });

    booking.stripePaymentIntentId = paymentIntent.id;
    await this.bookingRepository.save(booking);

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: booking.totalAmount,
      currency: paymentIntent.currency,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const webhookSecret = this.configService.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid signature';
      this.logger.warn(`Webhook signature verification failed: ${message}`);
      throw new BadRequestException(`Webhook Error: ${message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await this.confirmBookingPayment(paymentIntent);
    } else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      this.logger.warn(
        `Payment failed for PaymentIntent ${paymentIntent.id} (Booking: ${paymentIntent.metadata?.bookingId ?? 'unknown'})`,
      );
    }

    return { received: true };
  }

  private async confirmBookingPayment(paymentIntent: Stripe.PaymentIntent) {
    const bookingId = paymentIntent.metadata?.bookingId;

    await this.dataSource.transaction(async (manager) => {
      const query = manager
        .createQueryBuilder(Booking, 'booking')
        .setLock('pessimistic_write');

      if (bookingId) {
        query.where('booking.id = :bookingId', { bookingId });
      } else {
        query.where('booking.stripePaymentIntentId = :piId', {
          piId: paymentIntent.id,
        });
      }

      const booking = await query.getOne();

      if (!booking) {
        this.logger.warn(
          `No booking found for succeeded PaymentIntent ${paymentIntent.id}`,
        );
        return;
      }

      // Idempotency: ignore duplicate webhook deliveries
      if (booking.status === BookingStatus.CONFIRMED) {
        return;
      }

      if (booking.status !== BookingStatus.PENDING) {
        this.logger.warn(
          `PaymentIntent ${paymentIntent.id} succeeded, but booking ${booking.id} is already ${booking.status}`,
        );
        return;
      }

      booking.status = BookingStatus.CONFIRMED;
      booking.stripePaymentIntentId = paymentIntent.id;
      await manager.save(booking);

      this.logger.log(
        `Booking ${booking.id} confirmed via PaymentIntent ${paymentIntent.id}`,
      );
    });
  }
}
