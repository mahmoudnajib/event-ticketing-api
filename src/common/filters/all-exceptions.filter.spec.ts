import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ method: 'POST', url: '/api/test' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('should format ValidationPipe error arrays with message "Validation failed" and errors array', () => {
    const exception = new BadRequestException({
      message: ['email must be an email', 'password is too short'],
      error: 'Bad Request',
      statusCode: 400,
    });

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      statusCode: 400,
      message: 'Validation failed',
      errors: ['email must be an email', 'password is too short'],
      path: '/api/test',
      timestamp: expect.any(String),
    });
  });

  it('should format standard HttpException without an errors field', () => {
    const exception = new NotFoundException('Event not found');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      statusCode: 404,
      message: 'Event not found',
      path: '/api/test',
      timestamp: expect.any(String),
    });
    expect(jsonMock.mock.calls[0][0]).not.toHaveProperty('errors');
  });

  it('should handle unknown Error as 500 Internal server error', () => {
    const loggerErrorSpy = jest
      .spyOn((filter as any).logger, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('Database connection lost'), host);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      statusCode: 500,
      message: 'Internal server error',
      path: '/api/test',
      timestamp: expect.any(String),
    });
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
