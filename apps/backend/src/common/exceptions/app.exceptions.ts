import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain-specific exceptions. Using named exception classes (instead of
 * throwing generic HttpException everywhere) keeps error semantics explicit
 * at the call site and lets the global exception filter format them
 * consistently without guessing intent from a status code.
 */

export class DocumentNotFoundException extends HttpException {
  constructor(documentId: string) {
    super(`Document '${documentId}' was not found`, HttpStatus.NOT_FOUND);
  }
}

export class ConversationNotFoundException extends HttpException {
  constructor(conversationId: string) {
    super(`Conversation '${conversationId}' was not found`, HttpStatus.NOT_FOUND);
  }
}

export class DocumentNotReadyException extends HttpException {
  constructor(status: string) {
    super(`Document is not ready for questions yet (status: ${status})`, HttpStatus.CONFLICT);
  }
}

export class InvalidDocumentStateException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.CONFLICT);
  }
}

export class InvalidFileException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class FileTooLargeException extends HttpException {
  constructor(maxSizeBytes: number) {
    super(
      `File exceeds the maximum allowed size of ${Math.floor(maxSizeBytes / (1024 * 1024))}MB`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

export class EmptyDocumentException extends HttpException {
  constructor() {
    super('The uploaded PDF is empty or contains no extractable text', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class PdfParsingException extends HttpException {
  constructor(message = 'Failed to parse the PDF file — it may be corrupted') {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class EmbeddingServiceException extends HttpException {
  constructor(message = 'Failed to generate embeddings') {
    super(message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class VectorStoreException extends HttpException {
  constructor(message = 'Vector store operation failed') {
    super(message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class LlmServiceException extends HttpException {
  constructor(message = 'Failed to generate an answer') {
    super(message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
