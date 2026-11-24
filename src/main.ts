import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import {
  ApiErrorResponseDto,
  PaginationMetaDto,
} from './common/swagger/api-response.decorator';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  configureApp(app);

  const config = new DocumentBuilder()
    .setTitle('Event Ticketing & Booking API')
    .setDescription(
      'Production-grade ticketing system API. All responses follow the standardized { success, statusCode, data, meta, errors, timestamp } envelope.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiErrorResponseDto, PaginationMetaDto],
  });
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
