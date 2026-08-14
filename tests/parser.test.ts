import { describe, expect, it } from 'vitest';
import { parseHiveLang } from '../src/v5/parser.js';

describe('HiveLang v5 parser', () => {
  it('reports an unsupported bare respond statement precisely', () => {
    const result = parseHiveLang('bot Example { respond }');

    expect(result.errors).toEqual([
      expect.stringMatching(/Unexpected keyword "respond" in bot body/),
    ]);
    expect(result.program.bots).toHaveLength(1);
  });

  it('links invalid cross-references without blocking syntax parsing', () => {
    const result = parseHiveLang(`
bot Linked {
  capabilities { support.lookup }
  on input { delegate to MissingAgent execute MissingPlan call billing.refund }
}`);

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Unknown delegate target/),
      expect.stringMatching(/Unknown plan/),
    ]));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/Unknown delegate target/) }),
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/Unknown plan/) }),
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/not declared in capabilities/) }),
    ]));
  });

  it('parses hyphenated integration slugs in capabilities and calls', () => {
    const result = parseHiveLang(`
bot TasksAssistant {
  capabilities {
    google-tasks.list_tasks
    - google-tasks.create_task
  }
  instructions { Read the user's tasks. }
  on user.message {
    tasks = call google-tasks.list_tasks with { limit: 10 }
    say tasks
  }
}`);

    expect(result.errors).toEqual([]);
    expect(result.program.bots[0].capabilities).toEqual([
      'google-tasks.list_tasks',
      'google-tasks.create_task',
    ]);
  });

  it('parses helper calls, member calls, unary operators, and comparisons', () => {
    const result = parseHiveLang(`
bot HelperBot {
  instructions { Normalize the incoming message. }
  on user.message {
    cleaned = trim(input.text)
    if (!isEmpty(cleaned) && length(cleaned) > 0) {
      say cleaned.toLowerCase()
    }
  }
}`);

    expect(result.errors).toEqual([]);
  });

  it('returns precise diagnostics for malformed source', () => {
    const result = parseHiveLang('bot Broken { description: "unterminated }');
    expect(result.errors).toContain('Unterminated string at 1:27');
  });
});
