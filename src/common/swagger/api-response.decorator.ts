import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

type ApiResponseOptionsWithSchema = Extract<
  Parameters<typeof ApiResponse>[0],
  { schema?: unknown }
>;
type SchemaObject = NonNullable<ApiResponseOptionsWithSchema['schema']>;
type SchemaProperty = NonNullable<SchemaObject['properties']>[string];

export class PaginationMetaDto {
  @ApiProperty({ example: 25 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success: boolean;

  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['email must be an email'],
  })
  errors?: string[];

  @ApiProperty({ example: '/api/auth/register' })
  path: string;

  @ApiProperty({ example: '2026-11-24T19:00:00.000Z' })
  timestamp: string;
}

export interface ApiStandardResponseOptions {
  status?: number;
  description?: string;
  isArray?: boolean;
  paginated?: boolean;
  dataSchema?: SchemaProperty;
}

export function ApiStandardResponse<TModel extends Type<unknown>>(
  model?: TModel,
  options: ApiStandardResponseOptions = {},
) {
  const {
    status = 200,
    description = 'Successful response',
    isArray = false,
    paginated = false,
    dataSchema,
  } = options;

  let resolvedDataSchema: SchemaProperty;
  if (dataSchema) {
    resolvedDataSchema = dataSchema;
  } else if (model && (isArray || paginated)) {
    resolvedDataSchema = {
      type: 'array',
      items: { $ref: getSchemaPath(model) },
    };
  } else if (model) {
    resolvedDataSchema = { $ref: getSchemaPath(model) };
  } else {
    resolvedDataSchema = { type: 'object', nullable: true };
  }

  const properties: Record<string, SchemaProperty> = {
    success: { type: 'boolean', example: true },
    statusCode: { type: 'number', example: status },
    data: resolvedDataSchema,
    timestamp: { type: 'string', format: 'date-time' },
  };

  const required = ['success', 'statusCode', 'data', 'timestamp'];

  if (paginated) {
    properties.meta = { $ref: getSchemaPath(PaginationMetaDto) };
    required.push('meta');
  }

  const extraModels: Type<unknown>[] = [ApiErrorResponseDto, PaginationMetaDto];
  if (model) {
    extraModels.push(model);
  }

  return applyDecorators(
    ApiExtraModels(...extraModels),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        properties,
        required,
      },
    }),
  );
}

export function ApiStandardErrorResponse(
  status: number,
  description: string,
) {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiResponse({
      status,
      description,
      type: ApiErrorResponseDto,
    }),
  );
}
