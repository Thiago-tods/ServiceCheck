import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/** Reports unexpected (non-HTTP) errors to Sentry, then lets Nest answer normally. */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) Sentry.captureException(exception);
    super.catch(exception, host);
  }
}
