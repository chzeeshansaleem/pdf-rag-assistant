import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Wraps the generated Prisma client in Nest's lifecycle so the connection
 * pool opens on startup and closes cleanly on shutdown, instead of every
 * caller managing its own PrismaClient instance.
 *
 * Prisma 7 requires an explicit driver adapter (no more implicit
 * datasource-URL connection), so the pg adapter is constructed here from
 * the same DATABASE_URL the rest of the app already reads via ConfigService.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('databaseUrl', { infer: true });
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres via Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
