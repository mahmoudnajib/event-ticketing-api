import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { TicketTier } from '../events/entities/ticket-tier.entity';
import { Booking } from './entities/booking.entity';

export interface ExpireBookingJobData {
  bookingId: string;
}

@Processor('bookings')
export class BookingsProcessor extends WorkerHost {
  private readonly logger = new Logger(BookingsProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<ExpireBookingJobData>): Promise<void> {
    if (job.name !== 'expire-booking') return;

    const { bookingId } = job.data;

    await this.dataSource.transaction(async (manager) => {
      const booking = await manager
        .createQueryBuilder(Booking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :id', { id: bookingId })
        .getOne();

      if (!booking || booking.status !== BookingStatus.PENDING) {
        return;
      }

      const tier = await manager
        .createQueryBuilder(TicketTier, 'tier')
        .setLock('pessimistic_write')
        .where('tier.id = :id', { id: booking.ticketTierId })
        .getOne();

      if (tier) {
        tier.availableQuantity += booking.quantity;
        await manager.save(tier);
      }

      booking.status = BookingStatus.EXPIRED;
      await manager.save(booking);

      this.logger.log(
        `Booking ${bookingId} expired; released ${booking.quantity} ticket(s) back to inventory.`,
      );
    });
  }
}
