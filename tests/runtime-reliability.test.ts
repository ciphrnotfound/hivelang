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
});
