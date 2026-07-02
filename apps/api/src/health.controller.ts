import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './core/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + readiness probe' })
  async check() {
    const dbOk = await this.prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);

    const status = dbOk ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      services: { database: dbOk ? 'ok' : 'error' },
    };
  }
}
