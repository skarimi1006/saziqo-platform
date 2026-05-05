// CLAUDE: Add new modules here. This file is the ONLY place modules
// are listed. Static imports give compile-time type safety and avoid
// dynamic file-system scanning.
//
// To add a module:
//   1. Place the module under apps/api/src/modules/{name}/
//   2. Export a default instance implementing PlatformModule
//   3. Add an import + push to MODULES below
//   4. Set enabled: true (or false to ship dark)
//
// At boot:
//   - app.module.ts statically picks up every enabled module's
//     registerNestModule() class and adds it to its imports array.
//   - core/module-registry/module-loader.service.ts reads this same
//     array via OnApplicationBootstrap to register each module with
//     ModuleRegistryService, merge metadata (permissions, notification
//     types, payment purposes, admin pages), run onInstall on first
//     boot, and call onBoot every boot. Disabled modules are skipped
//     in BOTH places so `enabled: false` ships dark — no routes
//     mounted, no lifecycle hooks fired.

import type { PlatformModule } from './core/module-registry/types';
import exampleModule from './modules/_example';
import agentsModule from './modules/agents';

// import buildersModule from './modules/builders';
// import templatesModule from './modules/templates';

export const MODULES: PlatformModule[] = [
  // CLAUDE: Reference module — copy this skeleton for new business modules.
  // Controlled via ENABLE_EXAMPLE_MODULE env var (default true in dev,
  // false in production). Set ENABLE_EXAMPLE_MODULE=false in production.
  exampleModule,
  // Agents marketplace (Phase 1B onward). Controlled via ENABLE_AGENTS_MODULE
  // (default true in dev, false in production).
  agentsModule,
  // buildersModule,
];
