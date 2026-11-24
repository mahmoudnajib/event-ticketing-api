import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enums';
import { User } from '../src/users/entities/user.entity';

describe('Event Ticketing API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let bookingsQueue: Queue;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    bookingsQueue = app.get<Queue>(getQueueToken('bookings'));

    await bookingsQueue.obliterate({ force: true });
    await dataSource.query(
      'TRUNCATE TABLE bookings, ticket_tiers, events, users RESTART IDENTITY CASCADE',
    );
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
    if (app) {
      await app.close();
    }
  });

  it('GET /api should return standardized success envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api').expect(200);

    expect(res.body).toEqual({
      success: true,
      statusCode: 200,
      data: 'Hello World!',
      timestamp: expect.any(String),
    });
  });

  it('POST /api/auth/register should return standardized validation error envelope with errors array', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'A',
        email: 'not-an-email',
        password: '123',
        extraField: 'forbidden',
      })
      .expect(400);

    expect(res.body).toEqual({
      success: false,
      statusCode: 400,
      message: 'Validation failed',
      errors: expect.any(Array),
      path: '/api/auth/register',
      timestamp: expect.any(String),
    });
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('should execute full auth, event creation/publishing, booking, pagination, and cancellation flow matching standardized contract', async () => {
    // 1. Register organizer and promote role to ORGANIZER
    const organizerRegister = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'E2E Organizer',
        email: 'organizer.e2e@example.com',
        password: 'StrongPassword123!',
      })
      .expect(201);

    expect(organizerRegister.body).toEqual({
      success: true,
      statusCode: 201,
      data: {
        user: expect.objectContaining({
          email: 'organizer.e2e@example.com',
          role: Role.USER,
        }),
        accessToken: expect.any(String),
      },
      timestamp: expect.any(String),
    });

    await dataSource
      .getRepository(User)
      .update({ email: 'organizer.e2e@example.com' }, { role: Role.ORGANIZER });

    const organizerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'organizer.e2e@example.com',
        password: 'StrongPassword123!',
      })
      .expect(200);

    const organizerToken = organizerLogin.body.data.accessToken as string;

    // 2. Register regular customer and verify refresh token rotation
    const customerRegister = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'E2E Customer',
        email: 'customer.e2e@example.com',
        password: 'StrongPassword123!',
      })
      .expect(201);

    const customerCookies = customerRegister.headers['set-cookie'];
    expect(customerCookies).toBeDefined();

    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', customerCookies)
      .expect(200);

    expect(refreshRes.body).toEqual({
      success: true,
      statusCode: 200,
      data: { accessToken: expect.any(String) },
      timestamp: expect.any(String),
    });
    const customerToken = refreshRes.body.data.accessToken as string;

    // 3. Regular USER cannot create events (403 error envelope without errors array)
    const forbiddenEventRes = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        title: 'Unauthorized Event',
        description: 'Should fail',
        venue: 'Venue',
        city: 'Cairo',
        category: 'Tech',
        startDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
        endDate: new Date(Date.now() + 8 * 86400_000).toISOString(),
        ticketTiers: [{ name: 'GA', price: 25, totalQuantity: 10 }],
      })
      .expect(403);

    expect(forbiddenEventRes.body).toEqual({
      success: false,
      statusCode: 403,
      message: 'Forbidden resource',
      path: '/api/events',
      timestamp: expect.any(String),
    });
    expect(forbiddenEventRes.body).not.toHaveProperty('errors');

    // 4. Organizer creates and publishes an event
    const createEventRes = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Cairo E2E Tech Summit',
        description: 'End-to-end test summit',
        venue: 'CICC',
        city: 'Cairo',
        category: 'Technology',
        startDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
        endDate: new Date(Date.now() + 8 * 86400_000).toISOString(),
        ticketTiers: [{ name: 'VIP', price: 120, totalQuantity: 10 }],
      })
      .expect(201);

    const eventId = createEventRes.body.data.id as string;
    const tierId = createEventRes.body.data.ticketTiers[0].id as string;

    await request(app.getHttpServer())
      .patch(`/api/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    // 5. Public paginated events listing returns { success, statusCode, data, meta, timestamp }
    const listEventsRes = await request(app.getHttpServer())
      .get('/api/events?page=1&limit=5')
      .expect(200);

    expect(listEventsRes.body).toEqual({
      success: true,
      statusCode: 200,
      data: expect.arrayContaining([
        expect.objectContaining({ id: eventId, title: 'Cairo E2E Tech Summit' }),
      ]),
      meta: {
        total: 1,
        page: 1,
        limit: 5,
        totalPages: 1,
      },
      timestamp: expect.any(String),
    });

    // 6. Customer books tickets
    const createBookingRes = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ ticketTierId: tierId, quantity: 2 })
      .expect(201);

    const bookingId = createBookingRes.body.data.id as string;
    expect(createBookingRes.body).toEqual({
      success: true,
      statusCode: 201,
      data: expect.objectContaining({
        id: bookingId,
        status: 'PENDING',
        quantity: 2,
        totalAmount: 240,
      }),
      timestamp: expect.any(String),
    });

    // 7. Customer lists own bookings with pagination meta
    const myBookingsRes = await request(app.getHttpServer())
      .get('/api/bookings/my-bookings?page=1&limit=10')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(myBookingsRes.body).toEqual({
      success: true,
      statusCode: 200,
      data: [expect.objectContaining({ id: bookingId })],
      meta: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
      timestamp: expect.any(String),
    });

    // 8. Customer cancels booking and logs out
    const cancelRes = await request(app.getHttpServer())
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(cancelRes.body.data.status).toBe('CANCELLED');

    const logoutRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(logoutRes.body).toEqual({
      success: true,
      statusCode: 200,
      data: { message: 'Logged out successfully' },
      timestamp: expect.any(String),
    });
  });
});
