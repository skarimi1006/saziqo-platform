// strip-comments.ts — Phase 16B: Remove `// CLAUDE:` and `// REVIEW:`
// comment markers from compiled production JS.
//
// Why this exists:
//   The codebase uses `// CLAUDE: …` for in-source context aimed at
//   future Claude sessions and `// REVIEW: …` to flag things for human
//   review. Both are useful during development but are not for end users
//   and may leak implementation hints. They are stripped from the
//   release artifact.
//
// What this preserves (intentionally NOT touched):
//   - `// TODO(scope): …` — tracked work items
//   - `// SECURITY: …`    — security-relevant notes (audit-friendly)
//   - `/*! … */`           — license / preserve comments
//   - `// @ts-ignore`, `// @ts-expect-error` — TypeScript pragmas
//   - `//# sourceMappingURL=…` — source-map pragmas
//
// Approach:
//   Two regexes against the file as a string. AST-based tools would be
//   safer against pathological edge cases (e.g. the literal text
//   `// CLAUDE:` inside a JS string), but the convention is to never
//   write `CLAUDE:` inside string literals — concatenate as
//   `'CLAU' + 'DE:'` if you ever need that exact substring at runtime.
//   The regexes are anchored to line start (with optional leading
//   whitespace) so end-of-line comments after live code are not
//   touched, which keeps the post-strip JS syntactically valid.
//
// Usage:
//   pnpm tsx infra/scripts/strip-comments.ts            # mutate in place
//   pnpm tsx infra/scripts/strip-comments.ts --dry-run  # report only
//
// Exports `stripComments` for unit tests.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { glob } from 'glob';

// ─── Regexes ─────────────────────────────────────────────────────────────────
// Single-line: `^[\t ]*// CLAUDE: …` (or REVIEW). Anchored to line start
// to avoid stripping `const x = 1; // CLAUDE: foo` and leaving a half
// statement. Trailing newline consumed so a stripped line doesn't leave
// a blank gap.
const SINGLE_LINE = /^[\t ]*\/\/\s*(CLAUDE|REVIEW):.*$\n?/gm;

// Multi-line: `/* CLAUDE: … */`. Non-greedy so adjacent block comments
// don't get merged. Trailing newline consumed for the same reason.
const MULTI_LINE = /\/\*\s*(CLAUDE|REVIEW):[\s\S]*?\*\/\s*\n?/g;

export function stripComments(source: string): string {
  return source.replace(SINGLE_LINE, '').replace(MULTI_LINE, '');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const PATTERNS = ['apps/api/dist/**/*.js', 'apps/web/.next/**/*.js'];
const LOG_FILE = 'comment-strip-log.txt';

interface RunOptions {
  dryRun: boolean;
}

async function run(options: RunOptions): Promise<void> {
  const cwd = process.cwd();
  const modified: string[] = [];

  for (const pattern of PATTERNS) {
    const files = await glob(pattern, {
      cwd,
      ignore: ['**/node_modules/**'],
      nodir: true,
    });

    for (const rel of files) {
      const abs = path.join(cwd, rel);
      const original = fs.readFileSync(abs, 'utf8');
      const stripped = stripComments(original);

      if (stripped === original) continue;

      modified.push(rel);
      if (!options.dryRun) {
        fs.writeFileSync(abs, stripped, 'utf8');
      }
    }
  }

  const verb = options.dryRun ? 'Would strip' : 'Stripped';
  console.log(`[strip-comments] ${verb} CLAUDE/REVIEW comments from ${modified.length} file(s)`);

  if (!options.dryRun) {
    fs.writeFileSync(
      path.join(cwd, LOG_FILE),
      modified.join('\n') + (modified.length ? '\n' : ''),
      'utf8',
    );
    if (modified.length > 0) {
      console.log(`[strip-comments] Wrote ${LOG_FILE}`);
    }
  } else if (modified.length > 0) {
    console.log('[strip-comments] (dry-run) files that would be modified:');
    for (const f of modified) console.log(`  ${f}`);
  }
}

// Run only when invoked directly (not when imported by tests). We compare on
// basename rather than `import.meta.filename` because tsx's CJS transform
// leaves `import.meta` undefined; basename-on-argv[1] works in both modes.
const entry = process.argv[1] ? path.basename(process.argv[1]) : '';
if (entry === 'strip-comments.ts' || entry === 'strip-comments.js') {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun }).catch((err) => {
    console.error('[strip-comments] FAILED:', err);
    process.exit(1);
  });
}
