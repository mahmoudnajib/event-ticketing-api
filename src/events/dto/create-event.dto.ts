import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { EventStatus } from '../../common/enums/event-status.enum';
import { CreateTicketTierDto } from './create-ticket-tier.dto';

export class CreateEventDto {
  @ApiProperty({ example: 'Cairo Tech Summit 2026' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Annual backend and cloud engineering conference.' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 'Cairo International Convention Center' })
  @IsString()
  @IsNotEmpty()
  venue: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Technology' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ example: '2026-12-15T10:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-12-15T18:00:00.000Z' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: 'https://example.com/banner.jpg' })
  @IsUrl()
  @IsOptional()
  bannerUrl?: string;

  @ApiPropertyOptional({ enum: EventStatus, default: EventStatus.DRAFT })
  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;

  @ApiProperty({ type: [CreateTicketTierDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTicketTierDto)
  ticketTiers: CreateTicketTierDto[];
}
