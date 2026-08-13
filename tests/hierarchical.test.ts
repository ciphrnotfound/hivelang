import { describe, it, expect } from 'vitest';
import { HiveLangV5Runtime, AICallFunction, AIResponse } from '../src/v5/runtime.js';

/**
 * Tests for hierarchical (manager-driven) execution — the QueenBee pattern:
 * decompose a goal → run each subtask via a specialist sub-agent → synthesize.
 */

const CREW = `
bot Briefer {
  instructions: "Produce a short briefing."

  agent Researcher {
    role: "Gathers facts"
    capabilities: ["web.search"]
  }

  agent Writer {
    role: "Writes prose"
    capabilities: ["text.format"]
  }
}
`;

function registerStubs(rt: HiveLangV5Runtime) {
    for (const cap of ['web.search', 'text.format']) {
        rt.registerTool(cap, async () => ({ output: `${cap} ran` }), {
            name: cap, description: 'stub', parameters: { type: 'object', properties: {} },
        });
    }
}

describe('hierarchical execution', () => {
    it('decomposes a goal, runs each specialist, and synthesizes a final answer', async () => {
        const calls: Array<{ systemPrompt: string; lastUser: string }> = [];

        const ai: AICallFunction = async (systemPrompt, messages): Promise<AIResponse> => {
            const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
            calls.push({ systemPrompt, lastUser });

            // Planning call: manager asked to return a JSON plan.
            if (lastUser.includes('Respond with ONLY a JSON array')) {
                return {
                    content: 'Here is the plan: [{"agent":"Researcher","task":"find facts"},{"agent":"Writer","task":"write it up"}]',
                };
            }
            // Synthesis call.
            if (lastUser.includes('Write the final answer')) {
                return { content: 'FINAL BRIEFING' };
            }
            // Sub-agent calls (identified by their own prompts).
            if (systemPrompt.startsWith('You are Researcher')) return { content: 'facts: a, b, c' };
            if (systemPrompt.startsWith('You are Writer')) return { content: 'polished prose' };
            return { content: 'unexpected' };
        };

        const rt = new HiveLangV5Runtime(ai);
        registerStubs(rt);
        rt.loadCode(CREW);

        const ctx = await rt.executeHierarchical('Briefer', 'Brief me on quantum computing');

        // Both specialists ran, in plan order.
        const subAgentNames = calls
            .map(c => c.systemPrompt.match(/^You are (\w+)/)?.[1])
            .filter((n): n is string => Boolean(n));
        expect(subAgentNames).toEqual(['Researcher', 'Writer']);

        // Each subtask result is exposed for later steps + synthesis ran last.
        expect(ctx.variables['Researcher_result']).toContain('facts: a, b, c');
        expect(ctx.variables['Writer_result']).toContain('polished prose');
        expect(ctx.output).toContain('FINAL BRIEFING');
        expect(ctx.errors).toHaveLength(0);
    });

    it('falls back to a single subtask when the plan cannot be parsed', async () => {
        const ai: AICallFunction = async (systemPrompt, messages): Promise<AIResponse> => {
            const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
            if (lastUser.includes('Respond with ONLY a JSON array')) {
                return { content: 'sorry, I cannot produce JSON' }; // unparseable
            }
            if (lastUser.includes('Write the final answer')) return { content: 'done anyway' };
            if (systemPrompt.startsWith('You are Researcher')) return { content: 'fallback result' };
            return { content: 'x' };
        };

        const rt = new HiveLangV5Runtime(ai);
        registerStubs(rt);
        rt.loadCode(CREW);

        const ctx = await rt.executeHierarchical('Briefer', 'do the thing');

        // Fell back to the first agent and still produced a final answer.
        expect(ctx.output.some(o => o.includes('Could not produce a structured plan'))).toBe(true);
        expect(ctx.variables['Researcher_result']).toContain('fallback result');
        expect(ctx.output).toContain('done anyway');
    });

    it('delegates to execute() when the bot has no sub-agents', async () => {
        const ai: AICallFunction = async () => ({ content: 'plain reply' });
        const rt = new HiveLangV5Runtime(ai);
        rt.loadCode(`bot Solo { instructions: "chat" }`);

        const ctx = await rt.executeHierarchical('Solo', 'hi');
        expect(ctx.output).toContain('plain reply');
    });
});
