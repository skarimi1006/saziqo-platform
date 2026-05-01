import { sanitizeSvg } from './svg-sanitizer';

describe('sanitizeSvg', () => {
  it('strips <script> elements with their content', () => {
    const input = '<svg><script>alert(1)</script><rect/></svg>';
    expect(sanitizeSvg(input)).toBe('<svg><rect/></svg>');
  });

  it('strips self-closing <script /> elements', () => {
    const input = '<svg><script src="evil.js"/><rect/></svg>';
    expect(sanitizeSvg(input)).toBe('<svg><rect/></svg>');
  });

  it('strips <foreignObject> blocks', () => {
    const input = '<svg><foreignObject><iframe/></foreignObject><rect/></svg>';
    expect(sanitizeSvg(input)).toBe('<svg><rect/></svg>');
  });

  it('strips on* event-handler attributes (single, double, unquoted)', () => {
    expect(sanitizeSvg('<g onload="x()"/>')).toBe('<g/>');
    expect(sanitizeSvg("<g onclick='x()'/>")).toBe('<g/>');
    expect(sanitizeSvg('<g onerror=x/>')).toBe('<g/>');
  });

  it('strips javascript: URLs from href / xlink:href', () => {
    expect(sanitizeSvg('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeSvg('<use xlink:href="javascript:foo"/>')).toBe('<use/>');
  });

  it('strips data:/http(s):/file: external resource href targets', () => {
    expect(sanitizeSvg('<image href="data:image/png;base64,AAAA"/>')).toBe('<image/>');
    expect(sanitizeSvg('<image href="https://attacker.example/img.png"/>')).toBe('<image/>');
  });

  it('preserves a clean SVG unchanged', () => {
    const clean =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    expect(sanitizeSvg(clean)).toBe(clean);
  });

  it('preserves local fragment href references (e.g. <use href="#gradient1">)', () => {
    const input = '<svg><defs/><use href="#g1"/></svg>';
    expect(sanitizeSvg(input)).toBe(input);
  });
});
