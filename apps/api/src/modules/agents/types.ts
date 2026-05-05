// CLAUDE: Internal TypeScript types for the agents module. Domain DTOs
// live in dto/ once Phase 1B onward arrives. This file is the
// non-Prisma type surface — anything that's used across services within
// this module but not exposed to other modules.

export type AgentsListingStatusName =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'SUSPENDED';

export type AgentsPricingTypeName = 'FREE' | 'ONE_TIME' | 'PER_RUN';

export type AgentsPurchaseStatusName = 'COMPLETED' | 'REFUNDED';

export type AgentsRunOutcomeName = 'CONSUMED' | 'REFUSED_INSUFFICIENT' | 'REFUSED_INVALID_KEY';
