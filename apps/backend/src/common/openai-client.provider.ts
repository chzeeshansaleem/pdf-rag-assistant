import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * DI token for the shared OpenAI SDK client. Injecting the client (rather
 * than each service constructing its own `new OpenAI(...)`) means tests can
 * substitute a fake client and exercise EmbeddingsService/RagService without
 * any network access or API key — see their .spec.ts files.
 */
export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export const OpenAiClientProvider: Provider = {
  provide: OPENAI_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const apiKey = configService.get<string>('openai.apiKey', { infer: true });
    return new OpenAI({ apiKey: apiKey || undefined });
  },
};
