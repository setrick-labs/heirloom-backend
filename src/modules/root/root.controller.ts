import { Controller, Get } from '@nestjs/common';

import { env } from '../../config/env';
import { Public } from '../../shared/guards/public.decorator';

/**
 * `GET /` — service identity.
 *
 * Exists because the bare domain is the first thing anyone tries, and a raw
 * 404 there is indistinguishable from "the deploy is broken". This answers
 * "yes, the API is here, and here is where to look next" without exposing
 * anything: no versions of dependencies, no configuration, no route list.
 *
 * Deliberately does NOT check the database. It is the cheapest possible
 * "something is listening" response; `/health` is where dependency state
 * lives.
 */
@Controller()
export class RootController {
  @Public()
  @Get()
  index() {
    return {
      name: 'Heirloom API',
      // Not the package version: that would advertise the exact build to
      // anyone probing, and it is already available to operators in the logs.
      environment: env.NODE_ENV,
      health: '/health',
      liveness: '/health/live',
    };
  }
}
