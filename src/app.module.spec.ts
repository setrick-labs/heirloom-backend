import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';

/**
 * Compiles the entire module graph.
 *
 * The one thing tsc cannot check: a service that injects something no module
 * provides typechecks perfectly and fails at boot. Worth a test of its own
 * now that notifications reach into five feature services.
 */
describe('AppModule', () => {
  it('resolves every provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();
  });
});
