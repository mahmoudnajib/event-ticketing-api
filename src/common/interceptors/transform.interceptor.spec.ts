import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;

  const createContext = (statusCode = 200): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  it('should wrap a single object payload in { success, statusCode, data, timestamp }', async () => {
    const context = createContext(201);
    const next: CallHandler = {
      handle: () => of({ id: 'event-1', title: 'Concert' }),
    };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({
      success: true,
      statusCode: 201,
      data: { id: 'event-1', title: 'Concert' },
      timestamp: expect.any(String),
    });
    expect(result.meta).toBeUndefined();
  });

  it('should normalize undefined payload to data: null', async () => {
    const context = createContext(200);
    const next: CallHandler = {
      handle: () => of(undefined),
    };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      data: null,
      timestamp: expect.any(String),
    });
  });

  it('should unwrap { data, meta } paginated payloads into top-level data and meta', async () => {
    const context = createContext(200);
    const items = [{ id: '1' }, { id: '2' }];
    const meta = { total: 10, page: 1, limit: 2, totalPages: 5 };
    const next: CallHandler = {
      handle: () => of({ data: items, meta }),
    };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      data: items,
      meta,
      timestamp: expect.any(String),
    });
  });
});
