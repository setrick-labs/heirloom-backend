import { Controller, Get, Query } from '@nestjs/common';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../shared/guards/current-user.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { SearchService } from './search.service';
import {
  type SearchQuery,
  searchQuerySchema,
} from './validations/search.schema';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** Screen 41 — re-run live as the field is edited. */
  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ) {
    return this.searchService.search(user.id, query);
  }
}
