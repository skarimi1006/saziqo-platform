// CLAUDE: DEV-ONLY visual sandbox. Mounted at /dev/components.
//
// The original plan called for `_dev/components`, but Next.js App
// Router treats any folder prefixed with `_` as a *private* folder
// (non-routable). To keep the page reachable in dev we drop the
// underscore; production safety relies on two layers:
//   1. the `notFound()` guard below (runs at request time)
//   2. the release-build step (Phase 22A) strips the entire
//      `apps/web/src/app/dev/` subtree from the artifact.
// Do not link to this page from production nav, and do not add real
// data fetching here.
//
// Use this page to eyeball every shadcn primitive in Persian RTL after
// any rtl-related change in src/components/ui/*. Specifically watch:
//   - Toast lands top-LEFT (sonner.tsx wrapper)
//   - Switch thumb sits on the visual RIGHT when off
//   - Select chevron floats to the left, check mark on the right
//   - Dialog/Sheet close-X anchored top-LEFT
//   - Dropdown sub-menu chevron points LEFT (rtl:rotate-180)

import { notFound } from 'next/navigation';

import { ComponentSandboxClient } from './sandbox.client';

export const dynamic = 'force-dynamic';

export default function ComponentSandboxPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  return <ComponentSandboxClient />;
}
