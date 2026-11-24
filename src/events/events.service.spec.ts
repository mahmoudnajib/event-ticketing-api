import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EventStatus } from '../common/enums/event-status.enum';
import { Role } from '../common/enums/role.enums';
import { Event } from './entities/event.entity';
import { TicketTier } from './entities/ticket-tier.entity';
import { EventsService } from './events.service';

describe('EventsService', () => {
  let eventsService: EventsService;
  let eventRepository: jest.Mocked<Repository<Event>>;
  let ticketTierRepository: jest.Mocked<Repository<TicketTier>>;

  const organizerUser: JwtPayload = {
    sub: 'organizer-1',
    email: 'organizer@example.com',
    role: Role.ORGANIZER,
  };

  const otherOrganizer: JwtPayload = {
    sub: 'organizer-2',
    email: 'other@example.com',
    role: Role.ORGANIZER,
  };

  const adminUser: JwtPayload = {
    sub: 'admin-1',
    email: 'admin@example.com',
    role: Role.ADMIN,
  };

  const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const futureEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

  const buildEvent = (overrides: Partial<Event> = {}): Event =>
    ({
      id: 'event-1',
      title: 'Cairo Tech Summit',
      description: 'Engineering conference',
      venue: 'CICC',
      city: 'Cairo',
      category: 'Technology',
      startDate: futureStart,
      endDate: futureEnd,
      status: EventStatus.DRAFT,
      organizerId: organizerUser.sub,
      ticketTiers: [
        {
          id: 'tier-1',
          name: 'VIP',
          price: 100,
          totalQuantity: 50,
          availableQuantity: 50,
          eventId: 'event-1',
        } as TicketTier,
      ],
      ...overrides,
    }) as Event;

  const createQueryBuilderMock = (result: {
    getOne?: Event | null;
    getManyAndCount?: [Event[], number];
  }) => {
    const qb: Record<string, jest.Mock> = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result.getOne ?? null),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue(result.getManyAndCount ?? [[], 0]),
    };
    return qb;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getRepositoryToken(Event),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TicketTier),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    eventsService = module.get<EventsService>(EventsService);
    eventRepository = module.get(getRepositoryToken(Event));
    ticketTierRepository = module.get(getRepositoryToken(TicketTier));
  });

  describe('create', () => {
    it('should create an event and initialize availableQuantity equal to totalQuantity', async () => {
      const dto = {
        title: 'Cairo Tech Summit',
        description: 'Engineering conference',
        venue: 'CICC',
        city: 'Cairo',
        category: 'Technology',
        startDate: futureStart.toISOString(),
        endDate: futureEnd.toISOString(),
        ticketTiers: [{ name: 'VIP', price: 150, totalQuantity: 25 }],
      };
      const created = buildEvent();
      eventRepository.create.mockReturnValue(created);
      eventRepository.save.mockResolvedValue(created);

      const result = await eventsService.create(organizerUser.sub, dto);

      expect(eventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizerId: organizerUser.sub,
          ticketTiers: [
            { name: 'VIP', price: 150, totalQuantity: 25, availableQuantity: 25 },
          ],
        }),
      );
      expect(result).toEqual(created);
    });

    it('should reject events whose startDate is not in the future', async () => {
      await expect(
        eventsService.create(organizerUser.sub, {
          title: 'Past Event',
          description: 'Desc',
          venue: 'Venue',
          city: 'Cairo',
          category: 'Music',
          startDate: new Date(Date.now() - 10000).toISOString(),
          endDate: futureEnd.toISOString(),
          ticketTiers: [{ name: 'GA', price: 10, totalQuantity: 10 }],
        }),
      ).rejects.toThrow(
        new BadRequestException('Start date must be in the future'),
      );
    });
  });

  describe('findAll', () => {
    it('should apply pagination and return { data, meta } with calculated totalPages', async () => {
      const events = [buildEvent({ status: EventStatus.PUBLISHED })];
      const qb = createQueryBuilderMock({ getManyAndCount: [events, 25] });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);

      const result = await eventsService.findAll({
        page: 2,
        limit: 10,
        city: 'Cairo',
      });

      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.andWhere).toHaveBeenCalledWith(
        'LOWER(event.city) = LOWER(:city)',
        { city: 'Cairo' },
      );
      expect(result).toEqual({
        data: events,
        meta: {
          total: 25,
          page: 2,
          limit: 10,
          totalPages: 3,
        },
      });
    });

    it('should default to page 1 and limit 10 with totalPages = 0 when empty', async () => {
      const qb = createQueryBuilderMock({ getManyAndCount: [[], 0] });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);

      const result = await eventsService.findAll({});

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });
    });
  });

  describe('update', () => {
    it('should allow owner to update their event', async () => {
      const event = buildEvent();
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);
      eventRepository.save.mockImplementation(async (e) => e as Event);

      const result = await eventsService.update('event-1', organizerUser, {
        title: 'Updated Summit',
      });

      expect(result.title).toBe('Updated Summit');
    });

    it('should throw ForbiddenException (403) when a different organizer tries to update', async () => {
      const event = buildEvent();
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);

      await expect(
        eventsService.update('event-1', otherOrganizer, { title: 'Hijack' }),
      ).rejects.toThrow(
        new ForbiddenException(
          'You do not have permission to modify this event',
        ),
      );
    });

    it('should allow ADMIN to update any event', async () => {
      const event = buildEvent();
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);
      eventRepository.save.mockImplementation(async (e) => e as Event);

      const result = await eventsService.update('event-1', adminUser, {
        title: 'Admin Updated',
      });

      expect(result.title).toBe('Admin Updated');
    });
  });

  describe('publish', () => {
    it('should throw ForbiddenException (403) when unauthorized organizer tries to publish', async () => {
      const event = buildEvent();
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);

      await expect(
        eventsService.publish('event-1', otherOrganizer),
      ).rejects.toThrow(
        new ForbiddenException(
          'You do not have permission to modify this event',
        ),
      );
    });

    it('should publish draft event with at least one ticket tier', async () => {
      const event = buildEvent({ status: EventStatus.DRAFT });
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);
      eventRepository.save.mockImplementation(async (e) => e as Event);

      const result = await eventsService.publish('event-1', organizerUser);

      expect(result.status).toBe(EventStatus.PUBLISHED);
      expect(eventRepository.save).toHaveBeenCalled();
    });

    it('should reject publishing an event without ticket tiers', async () => {
      const event = buildEvent({ ticketTiers: [] });
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);

      await expect(
        eventsService.publish('event-1', organizerUser),
      ).rejects.toThrow(
        new BadRequestException(
          'Event must have at least one ticket tier before publishing',
        ),
      );
    });
  });

  describe('addTicketTier', () => {
    it('should add a ticket tier when called by owner', async () => {
      const event = buildEvent();
      const qb = createQueryBuilderMock({ getOne: event });
      eventRepository.createQueryBuilder.mockReturnValue(qb as any);
      const tier = {
        id: 'tier-2',
        name: 'Early Bird',
        price: 75,
        totalQuantity: 20,
        availableQuantity: 20,
        eventId: 'event-1',
      } as TicketTier;
      ticketTierRepository.create.mockReturnValue(tier);
      ticketTierRepository.save.mockResolvedValue(tier);

      const result = await eventsService.addTicketTier('event-1', organizerUser, {
        name: 'Early Bird',
        price: 75,
        totalQuantity: 20,
      });

      expect(ticketTierRepository.create).toHaveBeenCalledWith({
        name: 'Early Bird',
        price: 75,
        totalQuantity: 20,
        eventId: 'event-1',
        availableQuantity: 20,
      });
      expect(result).toEqual(tier);
    });
  });
});
