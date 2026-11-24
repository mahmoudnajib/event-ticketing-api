import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '2ad6e6a7-3f93-4e65-800d-533fe29fdd5f' })
  @IsUUID()
  ticketTierId: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity: number;
}
