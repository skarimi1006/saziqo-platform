// Tests for strip-comments.ts. Uses node:test (Node 20+ built-in)
// invoked through tsx — no Jest install required at the workspace root.
//
// Run via: pnpm test:scripts

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { stripComments } from '../strip-comments.ts';

describe('stripComments', () => {
  it('strips a single-line // CLAUDE: comment', () => {
    const input = `const x = 1;
// CLAUDE: this should be stripped
const y = 2;
`;
    const expected = `const x = 1;
const y = 2;
`;
    assert.equal(stripComments(input), expected);
  });

  it('strips a single-line // REVIEW: comment with leading indent', () => {
    const input = `function f() {
\t// REVIEW: revisit this branch
\treturn 1;
}
`;
    const expected = `function f() {
\treturn 1;
}
`;
    assert.equal(stripComments(input), expected);
  });

  it('strips a multi-line /* CLAUDE: ... */ block', () => {
    const input = `const x = 1;
/* CLAUDE:
   multi-line context
   spanning lines
*/
const y = 2;
`;
    const expected = `const x = 1;
const y = 2;
`;
    assert.equal(stripComments(input), expected);
  });

  it('preserves // TODO: comments', () => {
    const input = `// TODO(auth): rotate JWT secrets
const x = 1;
`;
    assert.equal(stripComments(input), input);
  });

  it('preserves // SECURITY: comments', () => {
    const input = `// SECURITY: never log this value
const token = 'secret';
`;
    assert.equal(stripComments(input), input);
  });

  it('preserves // @ts-ignore and // @ts-expect-error pragmas', () => {
    const input = `// @ts-ignore
const x: any = foo();
// @ts-expect-error
const y: any = bar();
`;
    assert.equal(stripComments(input), input);
  });

  it('preserves /*! license */ preserve comments', () => {
    const input = `/*! @license MIT — copyright 2026 */
export const VERSION = '1.0.0';
`;
    assert.equal(stripComments(input), input);
  });

  it('preserves //# sourceMappingURL pragmas', () => {
    const input = `const x = 1;
//# sourceMappingURL=foo.js.map
`;
    assert.equal(stripComments(input), input);
  });

  it('does not touch end-of-line comments after live code', () => {
    // Stripping these would leave a half-statement and break the file.
    const input = `const x = 1; // CLAUDE: not at line start
`;
    assert.equal(stripComments(input), input);
  });

  it('returns input unchanged when there is nothing to strip', () => {
    const input = `const x = 1;\nconst y = 2;\n`;
    assert.equal(stripComments(input), input);
  });
});
