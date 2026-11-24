# Event Ticketing & Booking API

A backend API for an event ticketing and reservation platform built with **NestJS**, **TypeORM**, **PostgreSQL**, **Redis (BullMQ)**, and **Stripe**. Designed to handle high-concurrency ticket purchases without overselling, automatic reservation expiration, and webhook-driven payment confirmation.

## Key Engineering Highlights

- **Overselling Prevention (Concurrency Control):** Wraps ticket reservations in PostgreSQL transactions using row-level pessimistic locking (`SELECT ... FOR UPDATE` via TypeORM `pessimistic_write`) on `TicketTier` records to eliminate race conditions under simultaneous requests.
- **Automated Reservation Expiration:** Uses **BullMQ** delayed jobs backed by **Redis** to hold `PENDING` bookings for 10 minutes. Unpaid reservations automatically transition to `EXPIRED` and release inventory back to the pool.
- **Idempotent Stripe Webhooks:** Verifies raw request signatures (`stripe-signature`) and processes `payment_intent.succeeded` events inside locked transactions so duplicate webhook deliveries safely resolve without side effects.
- **Authentication & RBAC:** JWT access/refresh token rotation with HTTP-only cookies, Google OAuth 2.0 integration, and role-based access control (`USER`, `ORGANIZER`, `ADMIN`).

## Tech Stack

- **Framework:** NestJS (TypeScript)
- **Database & ORM:** PostgreSQL 16, TypeORM
- **Queue & Cache:** Redis 7, BullMQ
- **Payments:** Stripe SDK (`PaymentIntents` & Webhooks)
- **Documentation & Validation:** Swagger / OpenAPI, `class-validator`, `class-transformer`
- **Infrastructure:** Docker & Docker Compose

## Getting Started

### 1. Clone & Install
```bash
git clone [https://github.com/mahmoudnajib/event-ticketing-api.git](https://github.com/mahmoudnajib/event-ticketing-api.git)
cd event-ticketing-api
npm install