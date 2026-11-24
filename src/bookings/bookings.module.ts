import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Event } from '../events/entities/event.entity';
import { TicketTier } from '../events/entities/ticket-tier.entity';
import { BookingsController } from './bookings.controller';
import { BookingsProcessor } from './bookings.processor';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, TicketTier, Event]),
    BullModule.registerQueue({
      name: 'bookings',
    }),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsProcessor],
  exports: [BookingsService, TypeOrmModule],
})
export class BookingsModule {}
