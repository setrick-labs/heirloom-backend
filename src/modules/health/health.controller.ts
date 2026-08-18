import { Controller, Get } from '@nestjs/common';

import { Public } from '../../shared/guards/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Readiness. 503 when the database is unreachable, so uptime monitoring
   * pointed here reflects whether the API can actually serve requests.
   */
  @Public()
  @Get()
  check() {
    return this.healthService.check();
  }

  /**
   * Liveness. Always 200 while the process is answering — point container
   * healthchecks here, not at `/health`, so a database blip doesn't get a
   * healthy container restarted.
   */
  @Public()
  @Get('live')
  live() {
    return this.healthService.live();
  }
}
