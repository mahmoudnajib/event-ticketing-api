import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ApiStandardErrorResponse,
  ApiStandardResponse,
} from '../common/swagger/api-response.decorator';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-intent')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a Stripe PaymentIntent for a pending booking' })
  @ApiStandardResponse(undefined, {
    status: 201,
    description: 'Stripe PaymentIntent created',
    dataSchema: {
      type: 'object',
      properties: {
        paymentIntentId: { type: 'string' },
        clientSecret: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string', example: 'usd' },
      },
    },
  })
  @ApiStandardErrorResponse(400, 'Booking cannot be paid')
  @ApiStandardErrorResponse(401, 'Unauthorized')
  @ApiStandardErrorResponse(403, 'Forbidden resource')
  @ApiStandardErrorResponse(404, 'Booking not found')
  createPaymentIntent(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.paymentsService.createPaymentIntent(userId, dto.bookingId);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe Webhook listener (called by Stripe servers)' })
  @ApiStandardResponse(undefined, {
    status: 200,
    description: 'Webhook processed',
    dataSchema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: true },
      },
    },
  })
  @ApiStandardErrorResponse(400, 'Invalid webhook payload or signature')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe webhook payload or signature');
    }
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }
}
