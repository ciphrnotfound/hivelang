import { describe, expect, it } from 'vitest';
import { parseHiveLang } from '../src/v5/parser.js';

describe('HiveLang v5 parser', () => {
  it('accepts a respond statement without a message', () => {
    const result = parseHiveLang('bot Example { respond }');

    expect(result.errors).toEqual([]);
    expect(result.program.bots).toHaveLength(1);
  });
});
