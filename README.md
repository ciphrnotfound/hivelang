# HiveLang

HiveLang is Bothive's custom, AI-first domain-specific language (DSL) for defining capable agents. A HiveLang file describes an agent's instructions, allowed tools, and optional specialist sub-agents; your application supplies the AI provider and tool implementations.

## Status

v5 is the version currently used by Bothive. It is an early, usable runtime; its API and language grammar may evolve before a stable 1.0 release. Do not expose untrusted HiveLang programs to high-privilege tools without a policy layer and explicit approval controls.

## Relationship to Bothive

HiveLang originated as the custom DSL that powers agent definitions in [Bothive](https://bothive.ai). Bothive uses the same v5 language model—tokenizer, parser, runtime, tool-capability model, and hierarchical agent execution—that this repository publishes.

This repository is the open-source language runtime, not the Bothive hosted application. Bothive's deployment additionally supplies authenticated APIs, AI-provider adapters, integrations and OAuth credentials, data storage, authorization, billing, and production observability. Those application services are intentionally not included here. When Bothive adopts a new HiveLang version, the corresponding runtime should be released here as the next version of this package.

## Install

```bash
npm install hivelang
```

## Quick start

```ts
import { createRuntime } from 'hivelang';

const source = `
bot SupportAgent {
  instructions {
    You are a concise and helpful support agent.
  }
  capabilities { tickets.lookup }
}`;

const runtime = createRuntime(async (_systemPrompt, messages, tools) => {
  // Adapt this callback to your LLM provider's SDK.
  console.log(messages, tools);
  return { content: 'How can I help?' };
});

runtime.registerTool(
  'tickets.lookup',
  async ({ id }) => ({ output: `Ticket ${id}: open` }),
  {
    name: 'tickets.lookup',
    description: 'Look up a support ticket by ID.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
);

runtime.loadCode(source);
const result = await runtime.execute('SupportAgent', 'Can you check ticket 42?');
console.log(result.output);
```

## Core concepts

- `instructions` provides the system prompt for the agent.
- `capabilities` declares the tools an agent may call. Register each implementation in the host application.
- `agent` defines a specialist that can participate in hierarchical execution.
- `createRuntime` accepts an AI-provider adapter; HiveLang does not send requests to an AI provider itself.

See [examples/devgenius.hive](examples/devgenius.hive) for a larger program.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

## Security

Treat agent programs, tool descriptions, and tool results as potentially untrusted input. Keep tools least-privileged, validate tool arguments, and require application-level approval for consequential actions. See [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
