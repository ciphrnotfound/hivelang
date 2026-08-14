import { describe, expect, it } from "vitest";
import { HiveLangV5Runtime } from "../src/v5/runtime.js";

describe("HiveLang v5 runtime reliability", () => {
  it("keeps private reasoning and tool-call narration out of user output", async () => {
    let turn = 0;
    const runtime = new HiveLangV5Runtime(async () => {
      turn += 1;
      if (turn === 1) {
        return {
          content: "I will inspect that now.",
          toolCalls: [{ name: "demo.lookup", arguments: { query: "record" } }],
        };
      }
      return { content: "<scratchpad>private chain</scratchpad>Here is the verified result." };
    });
    runtime.registerTool("demo.lookup", async () => ({ success: true, output: "record found" }), {
      name: "demo.lookup",
      description: "Look up a demo record",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    });
    runtime.loadCode(`bot CleanAgent {
  capabilities { demo.lookup }
  instructions { Use the lookup tool when needed. }
}`);

    const context = await runtime.execute("CleanAgent", "find it");

    expect(context.output).toEqual(["Here is the verified result."]);
    expect(context.output.join(" ")).not.toContain("private chain");
    expect(context.output.join(" ")).not.toContain("inspect that now");
  });

  it("stops repeating an identical failed tool call and marks an exhausted run", async () => {
    let executions = 0;
    const runtime = new HiveLangV5Runtime(
      async () => ({
        content: "",
        toolCalls: [{ name: "demo.lookup", arguments: { query: "same" } }],
      }),
      { maxIterations: 3 },
    );
    runtime.registerTool("demo.lookup", async () => {
      executions += 1;
      throw new Error("provider unavailable");
    }, {
      name: "demo.lookup",
      description: "Look up a demo record",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    });
    runtime.loadCode(`bot ReliableAgent {
  capabilities { demo.lookup }
  instructions { Use the lookup tool when needed. }
}`);

    const context = await runtime.execute("ReliableAgent", "find it");

    expect(executions).toBe(2);
    expect(context.toolCalls).toHaveLength(3);
    expect(context.toolCalls.every((call) => call.result?.success === false)).toBe(true);
    expect(context.errors.some((error) => error.includes("iteration tool limit"))).toBe(true);
  });

  it("blocks an invented tool but lets the agent repair with a permitted tool", async () => {
    let turn = 0;
    const runtime = new HiveLangV5Runtime(async () => {
      turn += 1;
      if (turn === 1) return { content: "", toolCalls: [{ name: "calendar.magicCreate", arguments: {} }] };
      if (turn === 2) return { content: "", toolCalls: [{ name: "demo.lookup", arguments: { query: "agenda" } }] };
      return { content: "I found the verified agenda." };
    });
    runtime.registerTool("demo.lookup", async () => ({ success: true, output: "agenda found" }), {
      name: "demo.lookup",
      description: "Look up a demo record",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    });
    runtime.loadCode(`bot RecoveryAgent {
  capabilities { demo.lookup }
  instructions { Use the lookup tool when needed. }
}`);

    const context = await runtime.execute("RecoveryAgent", "find my agenda");

    expect(context.errors).toEqual([]);
    expect(context.output).toEqual(["I found the verified agenda."]);
    expect(context.toolCalls[0]?.result?.success).toBe(false);
  });

  it("treats a casual agenda question as a calendar read request", async () => {
    let turn = 0;
    let prompt = "";
    let calendarReads = 0;
    const runtime = new HiveLangV5Runtime(async (systemPrompt) => {
      prompt = systemPrompt;
      turn += 1;
      if (turn === 1) {
        return { content: "", toolCalls: [{ name: "calendar.listEvents", arguments: { maxResults: 10 } }] };
      }
      return { content: "You have a product review at 10:00." };
    });
    runtime.registerTool("calendar.listEvents", async () => {
      calendarReads += 1;
      return { success: true, events: [{ title: "Product review", start: "10:00" }] };
    }, {
      name: "calendar.listEvents",
      description: "List upcoming calendar events",
      parameters: { type: "object", properties: { maxResults: { type: "number" } } },
    });
    runtime.registerTool("calendar.createEvent", async () => ({ success: true }), {
      name: "calendar.createEvent",
      description: "Create a calendar event",
      parameters: { type: "object", properties: { title: { type: "string" } } },
    });
    runtime.loadCode(`bot AgendaAgent {
  capabilities { calendar.listEvents calendar.createEvent }
  instructions { Help the user. }
}`);

    const context = await runtime.execute("AgendaAgent", "What's on my agenda for the day?");

    expect(calendarReads).toBe(1);
    expect(context.output).toEqual(["You have a product review at 10:00."]);
    expect(prompt).toContain("LIVE PERSONAL DATA REQUEST");
    expect(prompt).toContain("calendar.listEvents");
    expect(prompt).toContain("Do not use any write tool");
  });

  it("treats a natural PR-review question as a connected code read request", async () => {
    let turn = 0;
    let prompt = "";
    const runtime = new HiveLangV5Runtime(async (systemPrompt) => {
      prompt = systemPrompt;
      turn += 1;
      if (turn === 1) return { content: "", toolCalls: [{ name: "github.listPullRequests", arguments: {} }] };
      return { content: "Two pull requests are waiting for review." };
    });
    runtime.registerTool("github.listPullRequests", async () => ({ success: true, pullRequests: [] }), {
      name: "github.listPullRequests",
      description: "List pull requests awaiting review",
      parameters: { type: "object", properties: {} },
    });
    runtime.loadCode(`bot ReviewAgent {
  capabilities { github.listPullRequests }
  instructions { Help the user. }
}`);

    const context = await runtime.execute("ReviewAgent", "Which PRs need my review?");

    expect(context.output).toEqual(["Two pull requests are waiting for review."]);
    expect(prompt).toContain("LIVE PERSONAL DATA REQUEST");
    expect(prompt).toContain("github.listPullRequests");
  });

  it("keeps acknowledgements and capability questions tool-free", async () => {
    let prompt = "";
    const runtime = new HiveLangV5Runtime(async (systemPrompt) => {
      prompt = systemPrompt;
      return { content: "I can chat and use the tools you connect when you ask me to." };
    });
    runtime.registerTool("gmail.list", async () => ({ success: true }), {
      name: "gmail.list",
      description: "List recent inbox messages",
      parameters: { type: "object", properties: {} },
    });
    runtime.loadCode(`bot ConversationalAgent {
  capabilities { gmail.list }
  instructions { Be helpful. }
}`);

    const context = await runtime.execute("ConversationalAgent", "hm?");

    expect(context.toolCalls).toHaveLength(0);
    expect(prompt).toContain("CONVERSATIONAL TURN");
  });
});
