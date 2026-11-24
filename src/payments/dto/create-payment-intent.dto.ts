import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 'b291331a-0dc3-4d0c-9b42-e960d4e10c3f' })
  @IsUUID()
  bookingId: string;
}
