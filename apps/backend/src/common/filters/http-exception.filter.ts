import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

/**
 * Catches every unhandled exception and converts it into a clean, uniform
 * JSON error response. This is the single place responsible for making sure
 * internal details (stack traces, library error messages, SQL, etc.) never
 * leak to the frontend — only a status code and a safe message do.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof MulterError) {
      const status = exception.code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;
      response.status(status).json({
        statusCode: status,
        message: exception.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the maximum allowed upload size.' : exception.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const message = isHttpException
      ? typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as Record<string, unknown>)?.message ?? exception.message)
      : 'An unexpected error occurred. Please try again.';

    if (!isHttpException) {
      // Only truly unexpected errors are logged with their full stack —
      // known/expected HttpExceptions are already meaningful on their own.
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
