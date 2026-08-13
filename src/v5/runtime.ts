/**
 * HiveLang v5 Runtime - AI-First Execution Engine
 *
 * The fundamental difference from v3:
 * - AI is ALWAYS the brain, not a tool to be called
 * - Every user input goes to AI automatically
 * - HiveLang defines what AI knows (instructions) and can do (capabilities)
 */

import * as AST from './ast';
import { parseHiveLang, ParseResult } from './parser';

const DEFAULT_RESEARCH_CAPABILITIES = ["web.search", "browser.search"];

function stripPrivateReasoning(content: string): string {
    return content
        .replace(/<(?:scratchpad|thinking|analysis)>[\s\S]*?<\/(?:scratchpad|thinking|analysis)>/gi, '')
        .trim();
}

// In some TS compilation targets (no DOM) `console` may not be declared.
// Provide a minimal declaration to avoid "Cannot find name 'console'" errors.
declare const console: {
    log(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
};

// Exception for break statement
class BreakException extends Error {
    label?: string;
    constructor(label?: string) {
        super('Break');
        this.label = label;
    }
}

// ============ Types ============

export interface ExecutionContext {
    variables: Record<string, any>;
    output: string[];
    errors: string[];
    toolCalls: { tool: string; args: any; result?: any }[];
    memory?: Record<string, any>;  // Persistent memory for remember/recall
    checkpoints?: Record<string, Record<string, any>>;  // Named checkpoint states
    currentBotName?: string;  // Track which bot is executing
}

export interface AIResponse {
    content: string;
    toolCalls?: { name: string; arguments: Record<string, any> }[];
}

export type ToolFunction = (args: Record<string, any>, context: ExecutionContext) => Promise<any>;
export type AICallFunction = (systemPrompt: string, messages: { role: 'user' | 'assistant' | 'system' | 'tool', content: string, tool_calls?: any[], tool_call_id?: string, name?: string }[], tools: ToolDefinition[]) => Promise<AIResponse>;

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

export interface BotConfig {
    name: string;
    description?: string;
    systemPrompt: string;      // Built from instructions
    capabilities: string[];     // Tool names the AI can use
    beforeHook?: AST.BlockNode;
    afterHook?: AST.BlockNode;
    reactHandlers?: AST.ReActHandlerNode[];
    totHandlers?: AST.TreeOfThoughtsHandlerNode[];
    plans?: AST.PlanNode[];    // Reusable execution plans
    schedules?: AST.ScheduleNode[];  // Cron schedules
    webhooks?: AST.WebhookNode[];    // Webhook endpoints
    agents?: AgentConfig[];          // Specialized sub-agents this bot can delegate to
    grounding?: AST.GroundingNode;
    memoryPolicy?: AST.MemoryPolicyNode;
}

/**
 * Resolved configuration for a specialized sub-agent.
 * Unlike the old behavior (where sub-agent capabilities were flattened into the
 * parent and roles collapsed into prose), each sub-agent keeps its own identity:
 * its own role-driven system prompt and its own tool subset. This is what makes
 * CrewAI-style role-based delegation possible at runtime.
 */
export interface AgentConfig {
    name: string;
    role?: string;
    systemPrompt: string;
    capabilities: string[];
    body?: AST.BlockNode;
}

/**
 * Optional persistence hooks invoked at multi-agent boundaries. The runtime stays
 * pure (and unit tests stay fast/offline) by defaulting to a no-op sink; callers
 * that want durable, resumable multi-agent runs supply a sink backed by the
 * agent-collaboration layer (message bus + shared workspace artifacts).
 *
 * Every hook is best-effort: the runtime never lets a persistence failure abort
 * an agent run, so implementations should swallow/log their own errors.
 */
export interface CollaborationSink {
    /** A subtask is being handed to a sub-agent. */
    onDelegationStart?(info: { manager: string; agent: string; task: string; depth: number }): Promise<void>;
    /** A sub-agent finished; `result` is its output (or an error string). */
    onDelegationResult?(info: { manager: string; agent: string; task: string; result: string; error?: boolean }): Promise<void>;
    /** The hierarchical manager produced a decomposition plan. */
    onPlan?(info: { manager: string; goal: string; plan: Array<{ agent: string; task: string }> }): Promise<void>;
}

// ============ Formatting Helper ============

/**
 * Convert any result to human-readable text
 * Makes tool outputs pretty instead of showing raw JSON
 */
function formatResultAsText(result: any, toolName?: string): string {
    // Already has a formatted output field
    if (typeof result === 'object' && result !== null && result.output) {
        return result.output;
    }

    // String result - use directly
    if (typeof result === 'string') {
        return result;
    }

    // Null/undefined
    if (result === null || result === undefined) {
        return '✓ Done';
    }

    // Array - format as list
    if (Array.isArray(result)) {
        if (result.length === 0) return '📋 No items found';
        const items = result.slice(0, 10).map((item, i) => {
            if (typeof item === 'string') return `  ${i + 1}. ${item}`;
            if (typeof item === 'object' && item !== null) {
                // Try common field names for display
                const display = item.name || item.title || item.text || item.message || item.content || JSON.stringify(item);
                return `  ${i + 1}. ${display}`;
            }
            return `  ${i + 1}. ${String(item)}`;
        }).join('\n');
        return `📋 Found ${result.length} items:\n${items}${result.length > 10 ? '\n  ... and more' : ''}`;
    }

    // Object - format key-value pairs nicely
    if (typeof result === 'object') {
        const entries = Object.entries(result);
        if (entries.length === 0) return '✓ Done';

        // Skip internal fields and format nicely
        const formatted = entries
            .filter(([key]) => !key.startsWith('_') && key !== 'success' && key !== 'data')
            .map(([key, value]) => {
                // Format key as readable label
                const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
                const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);

                // Format value
                let displayValue: string;
                if (value === null || value === undefined) {
                    displayValue = 'Not set';
                } else if (typeof value === 'object') {
                    displayValue = Array.isArray(value) ? `${value.length} items` : JSON.stringify(value);
                } else {
                    displayValue = String(value);
                }

                return `  • ${capitalizedLabel}: ${displayValue}`;
            }).join('\n');

        const header = toolName ? `📊 **${toolName.split('.').pop()?.replace(/([A-Z])/g, ' $1').trim()} Result**` : '📊 **Result**';
        return `${header}\n${formatted}`;
    }

    // Fallback
    return String(result);
}

// ============ Runtime ============

export class HiveLangV5Runtime {
    private tools: Map<string, ToolFunction> = new Map();
    private toolDefinitions: Map<string, ToolDefinition> = new Map();
    /** The real tool names available for the current run — used to ground the
     *  model and to build the "no such tool" error. Set in execute(). */
    private availableToolNames: string[] = [];
    private aiCall: AICallFunction;
    private botConfigs: Map<string, BotConfig> = new Map();
    private botASTs: Map<string, AST.BotDefinitionNode> = new Map();  // Store for ReAct/ToT handlers

    // Maximum reasoning iterations (LLM call → tool → LLM call …) per agent loop.
    private maxIterations: number = 8;
    // Guard against runaway / cyclic delegation (agent A → B → A → …).
    private maxDelegationDepth: number = 4;
    // Optional persistence hooks for durable multi-agent runs (default: no-op).
    private collaboration: CollaborationSink = {};

    constructor(
        aiCall: AICallFunction,
        options?: { maxIterations?: number; maxDelegationDepth?: number; collaboration?: CollaborationSink }
    ) {
        this.aiCall = aiCall;
        if (options?.maxIterations && options.maxIterations > 0) this.maxIterations = options.maxIterations;
        if (options?.maxDelegationDepth && options.maxDelegationDepth > 0) this.maxDelegationDepth = options.maxDelegationDepth;
        if (options?.collaboration) this.collaboration = options.collaboration;
    }

    /** Attach (or replace) the collaboration sink after construction. */
    setCollaborationSink(sink: CollaborationSink) {
        this.collaboration = sink;
    }

    /** Invoke a sink hook without ever letting its failure break the agent run. */
    private async safeSink(fn: () => Promise<void> | void): Promise<void> {
        try {
            await fn();
        } catch (e: any) {
            console.warn(`[V5 Runtime] collaboration sink error (ignored): ${e?.message ?? e}`);
        }
    }

    /**
     * Register a tool that the AI can use
     */
    registerTool(name: string, fn: ToolFunction, definition?: ToolDefinition) {
        this.tools.set(name, fn);
        if (definition) {
            this.toolDefinitions.set(name, definition);
        } else {
            // Generate minimal definition
            this.toolDefinitions.set(name, {
                name,
                description: `Execute ${name}`,
                parameters: { type: 'object', properties: {} }
            });
        }
    }

    /**
     * Load HiveLang v5 code and extract bot configurations
     */
    loadCode(code: string): ParseResult {
        const result = parseHiveLang(code);

        for (const bot of result.program.bots) {
            const config = this.buildBotConfig(bot);
            this.botConfigs.set(bot.name, config);
            this.botASTs.set(bot.name, bot);  // Store AST for ReAct/ToT access
        }

        return result;
    }

    /**
     * Validate code without loading it into the runtime
     */
    validateCode(code: string): { success: boolean; errors?: string[] } {
        try {
            const result = parseHiveLang(code);
            if (result.errors && result.errors.length > 0) {
                return { success: false, errors: result.errors };
            }
            return { success: true };
        } catch (error: any) {
            return { success: false, errors: [error.message || "Unknown syntax error"] };
        }
    }

    /**
     * Get bot AST for ReAct/ToT handler matching
     */
    private getBotAST(name: string): AST.BotDefinitionNode | undefined {
        return this.botASTs.get(name);
    }

    /**
     * Pattern matching for trigger strings (supports wildcards like *, troubleshoot *)
     */
    private matchesPattern(input: string, pattern: string): boolean {
        // Simple wildcard matching: "troubleshoot *" matches "troubleshoot login issue"
        const regexPattern = pattern
            .replace(/\*/g, '.*')  // * matches anything
            .replace(/\?/g, '.');   // ? matches single char
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(input);
    }

    /**
     * Build bot config from AST
     */
    private buildBotConfig(bot: AST.BotDefinitionNode): BotConfig {
        // Build system prompt from instructions
        let systemPrompt = bot.instructions || '';

        if (bot.grounding?.knowledge === 'required') {
            systemPrompt += '\n\nGrounding contract: retrieve and use approved knowledge before answering factual questions. Do not answer from unsupported assumptions.';
            if (bot.grounding.citeSources) systemPrompt += ' Name the document or source when the retrieved result provides one.';
            if (bot.grounding.onMissing === 'say_uncertain') systemPrompt += ' If no relevant evidence is found, say you are not certain from the approved knowledge.';
        }
        if (bot.memoryPolicy) {
            systemPrompt += `\n\nMemory contract: mode=${bot.memoryPolicy.mode}.`;
            if (bot.memoryPolicy.rememberOnly.length) systemPrompt += ` Only retain: ${bot.memoryPolicy.rememberOnly.join(', ')}.`;
            if (bot.memoryPolicy.neverRemember.length) systemPrompt += ` Never retain: ${bot.memoryPolicy.neverRemember.join(', ')}.`;
        }

        // Resolve specialized sub-agents into first-class configs (each keeps its
        // own role + tools) and advertise them to the parent so the LLM knows it
        // can delegate. We no longer collapse roles into anonymous "capabilities".
        const agentConfigs: AgentConfig[] = (bot.agents ?? []).map(agent => ({
            name: agent.name,
            role: agent.role,
            capabilities: [...new Set([...agent.capabilities, ...DEFAULT_RESEARCH_CAPABILITIES])],
            body: agent.body,
            systemPrompt: agent.role
                ? `You are ${agent.name}, a specialized agent. Your role: ${agent.role}\n\nFocus only on the task delegated to you and return a clear, complete result.`
                : `You are ${agent.name}, a specialized agent. Complete the delegated task and return a clear result.`,
        }));

        if (agentConfigs.length > 0) {
            systemPrompt += '\n\nYou coordinate a team of specialized agents. Delegate focused subtasks to them with the `delegate` tool instead of doing their work yourself:\n';
            for (const agent of agentConfigs) {
                systemPrompt += `\n- ${agent.name}: ${agent.role || 'specialized agent'}`;
            }
            systemPrompt += '\n\nDelegate when a subtask matches an agent\'s role; synthesize their results into your final answer.';
        }

        // Global guidance for tool usage (applies to all v5 bots)
        systemPrompt += '\n\nTool Usage Guidelines:\n';
        systemPrompt += '- Only call tools when they are clearly needed to fulfill the user\'s request.\n';
        systemPrompt += '- Prefer answering directly when you already have enough information.\n';
        systemPrompt += '- Do not call tools on every single message—most turns should be normal conversation.\n';

        // Collect all capabilities
        const capabilities = [...bot.capabilities, ...DEFAULT_RESEARCH_CAPABILITIES];
        if (bot.agents) {
            for (const agent of bot.agents) {
                capabilities.push(...agent.capabilities);
            }
        }

        return {
            name: bot.name,
            description: bot.description,
            systemPrompt,
            capabilities: [...new Set(capabilities)], // Dedupe
            beforeHook: bot.beforeHook,
            afterHook: bot.afterHook,
            reactHandlers: bot.reactHandlers,
            totHandlers: bot.totHandlers,
            plans: bot.plans,
            schedules: bot.schedules,
            webhooks: bot.webhooks,
            agents: agentConfigs
            , grounding: bot.grounding
            , memoryPolicy: bot.memoryPolicy
        };
    }

    /**
     * Execute a message through a bot - THE AI-FIRST APPROACH
     *
     * This is the key difference from v3:
     * - Message goes DIRECTLY to AI
     * - AI decides which tools to use
     * - No explicit general.respond needed
     */
    async execute(botName: string, userMessage: string, additionalContext?: Record<string, any>): Promise<ExecutionContext> {
        const config = this.botConfigs.get(botName);
        if (!config) {
            throw new Error(`Bot not found: ${botName}`);
        }

        const context: ExecutionContext = {
            variables: { input: userMessage, ...additionalContext },
            output: [],
            errors: [],
            toolCalls: [],
            memory: {},
            currentBotName: botName
        };

        // 1. Execute before hook (if any)
        if (config.beforeHook) {
            await this.executeBlock(config.beforeHook, context);
        }

        // V5.1: run ordinary chat/input handlers before the AI-first fallback.
        // The parser has always accepted `on message { ... }`, but the standard
        // execution path ignored it unless it was a ReAct/ToT handler. That made
        // deterministic flows such as `knowledge.search -> ai.generate -> say`
        // look valid while silently never running. A handler may fully answer the
        // turn with `say`; otherwise the normal AI loop continues with its work.
        const bot = this.getBotAST(botName);
        const messageHandler = (bot?.events || []).find((event) =>
            ["message", "input", "chat"].includes(event.event.toLowerCase())
        );
        if (messageHandler) {
            await this.executeBlock(messageHandler.body, context);
            if (context.output.length > 0 || context.errors.length > 0) {
                return context;
            }
        }

        // 2. Check for ReAct/ToT handlers that match the input
        if (bot) {
            // Check ToT handlers first (more specific)
            for (const tot of bot.totHandlers || []) {
                if (this.matchesPattern(userMessage, tot.trigger)) {
                    return this.executeTreeOfThoughts(tot, config, userMessage, context);
                }
            }

            // Check ReAct handlers
            for (const react of bot.reactHandlers || []) {
                if (this.matchesPattern(userMessage, react.trigger)) {
                    return this.executeReAct(react, config, userMessage, context);
                }
            }
        }

        // 3. Standard AI-first execution loop (now shared with sub-agents)
        const tools = this.getToolDefinitionsForCapabilities(config.capabilities);

        // If this bot has specialized sub-agents, give the LLM a `delegate` tool so
        // it can hand focused subtasks to them at runtime (CrewAI-style, but the
        // delegation decision is made dynamically by the model, not pre-scripted).
        if (config.agents && config.agents.length > 0) {
            tools.push(this.buildDelegateToolDefinition(config.agents));
        }

        console.log(`[V5 Runtime] Bot ${botName} has ${config.capabilities.length} capabilities, found ${tools.length} matching tools`);
        if (tools.length > 0) {
            console.log(`[V5 Runtime] Available tools: ${tools.map(t => t.name).join(', ')}`);
        }

        // Record the real tools for this run so executeTool() can reject any
        // hallucinated tool with the authoritative list.
        this.availableToolNames = tools.map(t => t.name);

        // Ground the model: tell it EXACTLY which tools it has (with descriptions
        // and a usage note from any declared-but-unmatched capability) and forbid
        // inventing tools. This is the system-prompt half of anti-hallucination;
        // the executeTool() hard-error is the runtime half.
        const toolNamesLower = new Set(tools.map(t => t.name.toLowerCase()));
        const missingCaps = config.capabilities.filter(cap => {
            const isWildcard = cap.endsWith(".*") || !cap.includes(".");
            if (isWildcard) {
                // Satisfied if any selected tool belongs to this integration.
                const slug = (cap.endsWith(".*") ? cap.slice(0, -2) : cap).toLowerCase();
                for (const tn of toolNamesLower) {
                    if (tn.startsWith(`${slug}.`) || tn.startsWith(`integrations.${slug}.`) || tn.startsWith(`integration.${slug}.`)) {
                        return false;
                    }
                }
                return true;
            }
            if (toolNamesLower.has(cap.toLowerCase())) return false;
            return !this.normalizeCapabilityName(cap).some(v => toolNamesLower.has(v.toLowerCase()));
        });
        const systemPromptPrefix = typeof additionalContext?.systemPromptPrefix === 'string'
            ? additionalContext.systemPromptPrefix.trim()
            : '';
        const groundedPrompt = this.buildToolRoster(
            systemPromptPrefix ? `${systemPromptPrefix}\n\n${config.systemPrompt}` : config.systemPrompt,
            tools,
            missingCaps,
        );

        await this.runAgentLoop(groundedPrompt, userMessage, tools, context, config, 0);

        // 4. Execute after hook (if any)
        if (config.afterHook) {
            await this.executeBlock(config.afterHook, context);
        }

        return context;
    }

    /**
     * The core agentic loop: call the LLM, run any tools it requests, feed the
     * results back, and repeat until the model stops calling tools (or we hit the
     * iteration cap). Shared by the top-level bot and every delegated sub-agent so
     * delegated agents are full agents, not single-shot calls.
     *
     * `depth` tracks delegation nesting to prevent runaway/cyclic delegation.
     */
    private async runAgentLoop(
        systemPrompt: string,
        userMessage: string,
        tools: ToolDefinition[],
        context: ExecutionContext,
        config: BotConfig,
        depth: number
    ): Promise<string> {
        const messages: any[] = [{ role: 'user', content: userMessage }];
        let finalContent = '';
        let endedWithToolCalls = false;
        const failedCallCounts = new Map<string, number>();

        for (let iter = 0; iter < this.maxIterations; iter++) {
            let aiResponse: AIResponse;
            try {
                aiResponse = await this.aiCall(systemPrompt, messages, tools);
            } catch (e: any) {
                context.errors.push(`AI execution error: ${e.message}`);
                break;
            }

            const visibleContent = aiResponse.content ? stripPrivateReasoning(aiResponse.content) : '';
            if (visibleContent) {
                finalContent = visibleContent;
                // Tool-call narration is intermediate reasoning, not the final
                // user-facing answer. Keep it in the model transcript only.
                if (!aiResponse.toolCalls?.length) {
                    context.output.push(visibleContent);
                    messages.push({ role: 'assistant', content: visibleContent });
                }
            }

            if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
                endedWithToolCalls = true;
                console.log(`[V5 Runtime] (depth ${depth}) Iteration ${iter + 1}: AI called ${aiResponse.toolCalls.length} tools`);
                messages.push({
                    role: 'assistant',
                    content: visibleContent,
                    tool_calls: aiResponse.toolCalls.map(tc => ({
                        id: `call_${Math.random().toString(36).substring(7)}`,
                        type: 'function',
                        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
                    }))
                });

                const lastAssistantMessage = messages[messages.length - 1];
                for (let i = 0; i < aiResponse.toolCalls.length; i++) {
                    const call = aiResponse.toolCalls[i];
                    const toolCallId = lastAssistantMessage.tool_calls[i].id;
                    const callSignature = `${call.name}:${JSON.stringify(call.arguments || {})}`;

                    // Intercept the synthetic `delegate` tool — it isn't a registered
                    // tool, it routes into a sub-agent's own agentic loop.
                    let result: any;
                    if ((failedCallCounts.get(callSignature) || 0) >= 2) {
                        result = {
                            success: false,
                            output: `The identical ${call.name} call already failed twice. Do not repeat it again; change the parameters, choose another available tool, or explain the blocker.`,
                        };
                        context.toolCalls.push({ tool: call.name, args: call.arguments, result });
                    } else if (call.name === 'delegate') {
                        result = await this.executeDelegate(
                            String(call.arguments?.agent ?? ''),
                            String(call.arguments?.task ?? ''),
                            context,
                            config,
                            depth
                        );
                    } else {
                        result = await this.executeTool(call.name, call.arguments, context);
                    }

                    if (result && typeof result === 'object' && result.success === false) {
                        failedCallCounts.set(callSignature, (failedCallCounts.get(callSignature) || 0) + 1);
                    } else {
                        failedCallCounts.delete(callSignature);
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: call.name,
                        content: typeof result === 'object' ? JSON.stringify(result) : String(result)
                    });
                }
            } else {
                endedWithToolCalls = false;
                console.log(`[V5 Runtime] (depth ${depth}) Iteration ${iter + 1}: AI did not call any tools. Loop finished.`);
                break;
            }
        }

        if (endedWithToolCalls) {
            const error = `Agent reached the ${this.maxIterations}-iteration tool limit before producing a final answer.`;
            context.errors.push(error);
            if (context.output.length === 0) context.output.push("I could not complete that safely within this run. No unverified action was reported as successful.");
        }

        return finalContent;
    }

    /**
     * Build the synthetic `delegate` tool definition advertised to a coordinating
     * bot. The enum constrains the model to only delegate to agents that exist.
     */
    private buildDelegateToolDefinition(agents: AgentConfig[]): ToolDefinition {
        const roster = agents
            .map(a => `${a.name} (${a.role || 'specialized agent'})`)
            .join('; ');
        return {
            name: 'delegate',
            description: `Hand a focused subtask to one of your specialized agents and get their result back. Available agents: ${roster}.`,
            parameters: {
                type: 'object',
                properties: {
                    agent: {
                        type: 'string',
                        enum: agents.map(a => a.name),
                        description: 'The name of the agent to delegate to.'
                    },
                    task: {
                        type: 'string',
                        description: 'A clear, self-contained description of the subtask for the agent to complete.'
                    }
                },
                required: ['agent', 'task']
            }
        };
    }

    /**
     * Run a named sub-agent as a full agent (its own role-based system prompt and
     * its own tool subset) and return its result to the caller. Shares the parent's
     * ExecutionContext so tool calls, errors, and output remain in one transcript.
     */
    private async executeDelegate(
        agentName: string,
        task: string,
        context: ExecutionContext,
        parentConfig: BotConfig,
        depth: number
    ): Promise<{ agent: string; result?: string; error?: string }> {
        const manager = context.currentBotName ?? parentConfig.name;

        if (depth + 1 > this.maxDelegationDepth) {
            const error = `Delegation depth limit (${this.maxDelegationDepth}) reached; refusing to delegate to ${agentName}.`;
            context.errors.push(error);
            await this.safeSink(() => this.collaboration.onDelegationResult?.({
                manager, agent: agentName, task, result: error, error: true,
            }));
            return { agent: agentName, error };
        }

        const agent = parentConfig.agents?.find(a => a.name === agentName);
        if (!agent) {
            const available = (parentConfig.agents ?? []).map(a => a.name).join(', ') || 'none';
            const error = `Unknown agent "${agentName}". Available agents: ${available}.`;
            context.errors.push(error);
            await this.safeSink(() => this.collaboration.onDelegationResult?.({
                manager, agent: agentName, task, result: error, error: true,
            }));
            return { agent: agentName, error };
        }

        console.log(`[V5 Runtime] Delegating to ${agentName} (depth ${depth + 1}): ${task.slice(0, 80)}`);

        await this.safeSink(() => this.collaboration.onDelegationStart?.({
            manager, agent: agentName, task, depth: depth + 1,
        }));

        // The sub-agent gets only its own tools. If it in turn has no sub-agents of
        // its own, it simply won't receive a `delegate` tool — delegation is one
        // level unless agents are themselves coordinators.
        const subTools = this.getToolDefinitionsForCapabilities(agent.capabilities);

        const result = await this.runAgentLoop(
            agent.systemPrompt,
            task,
            subTools,
            context,
            parentConfig,
            depth + 1
        );

        const output = result || '(no output)';
        await this.safeSink(() => this.collaboration.onDelegationResult?.({
            manager, agent: agentName, task, result: output,
        }));

        return { agent: agentName, result: output };
    }

    /**
     * Hierarchical (manager-driven) execution — the "QueenBee" pattern.
     *
     * Instead of letting the coordinator improvise delegation turn-by-turn, a
     * manager LLM first DECOMPOSES the goal into ordered subtasks (each tagged
     * with the agent best suited to it), each subtask runs through the same
     * delegation machinery as a full agent, and finally the manager SYNTHESIZES
     * the collected results into one answer.
     *
     * This is opt-in (callers choose `executeHierarchical` over `execute`) and
     * reuses `executeDelegate` / `runAgentLoop`, so sub-agents remain real agents.
     */
    async executeHierarchical(
        botName: string,
        goal: string,
        additionalContext?: Record<string, any>
    ): Promise<ExecutionContext> {
        const config = this.botConfigs.get(botName);
        if (!config) {
            throw new Error(`Bot not found: ${botName}`);
        }
        if (!config.agents || config.agents.length === 0) {
            // No specialists to manage — fall back to the normal loop.
            return this.execute(botName, goal, additionalContext);
        }

        const context: ExecutionContext = {
            variables: { input: goal, ...additionalContext },
            output: [],
            errors: [],
            toolCalls: [],
            memory: {},
            currentBotName: botName
        };

        const roster = config.agents
            .map(a => `- ${a.name}: ${a.role || 'specialized agent'}`)
            .join('\n');

        // 1. DECOMPOSE — ask the manager for a JSON plan of subtasks.
        const planPrompt =
            `Goal: ${goal}\n\n` +
            `You manage these specialist agents:\n${roster}\n\n` +
            `Break the goal into the minimum set of ordered subtasks. Assign each subtask ` +
            `to the single most appropriate agent by name. Respond with ONLY a JSON array, ` +
            `e.g. [{"agent":"Researcher","task":"..."},{"agent":"Writer","task":"..."}].`;

        let plan: Array<{ agent: string; task: string }> = [];
        try {
            const planResponse = await this.aiCall(
                config.systemPrompt,
                [{ role: 'user', content: planPrompt }],
                []
            );
            plan = this.parsePlanJSON(planResponse.content);
        } catch (e: any) {
            context.errors.push(`Planning failed: ${e.message}`);
        }

        // Fallback: if planning produced nothing usable, treat the whole goal as
        // one task for the first agent rather than silently doing nothing.
        if (plan.length === 0) {
            plan = [{ agent: config.agents[0].name, task: goal }];
            context.output.push('⚠️ Could not produce a structured plan; running goal as a single subtask.');
        }

        await this.safeSink(() => this.collaboration.onPlan?.({ manager: botName, goal, plan }));

        // 2. EXECUTE — run each subtask through a real sub-agent.
        const completed: Array<{ agent: string; task: string; result: string }> = [];
        for (const subtask of plan) {
            const delegation = await this.executeDelegate(
                subtask.agent,
                subtask.task,
                context,
                config,
                0
            );
            const result = delegation.result ?? delegation.error ?? '(no result)';
            completed.push({ agent: subtask.agent, task: subtask.task, result });
            // Expose each result to later subtasks via the shared variable space.
            context.variables[`${subtask.agent}_result`] = result;
        }

        // 3. SYNTHESIZE — manager combines the subtask results into a final answer.
        const synthesisPrompt =
            `Goal: ${goal}\n\n` +
            `Your agents completed these subtasks:\n` +
            completed.map(c => `### ${c.agent} — ${c.task}\n${c.result}`).join('\n\n') +
            `\n\nWrite the final answer to the original goal, synthesizing the above. Do not mention the delegation process.`;

        try {
            const finalResponse = await this.aiCall(
                config.systemPrompt,
                [{ role: 'user', content: synthesisPrompt }],
                []
            );
            if (finalResponse.content) {
                context.output.push(finalResponse.content);
            }
        } catch (e: any) {
            context.errors.push(`Synthesis failed: ${e.message}`);
        }

        if (config.afterHook) {
            await this.executeBlock(config.afterHook, context);
        }

        return context;
    }

    /**
     * Extract a [{agent, task}] plan from an LLM response that may wrap the JSON
     * in prose or a markdown fence. Only keeps entries with both fields as strings.
     */
    private parsePlanJSON(content: string): Array<{ agent: string; task: string }> {
        if (!content) return [];
        const match = content.match(/\[[\s\S]*\]/);
        if (!match) return [];
        try {
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((e: any) => e && typeof e.agent === 'string' && typeof e.task === 'string')
                .map((e: any) => ({ agent: e.agent, task: e.task }));
        } catch {
            return [];
        }
    }

    /**
     * Normalize capability name to match different naming conventions
     * Converts between camelCase, snake_case, and PascalCase
     * Handles provider.method format (e.g. twitter.post_tweet ↔ twitter.postTweet)
     * Also tries integration. and integrations. prefixed variants for dynamic tools
     */
    private normalizeCapabilityName(name: string): string[] {
        const variants = new Set<string>();
        variants.add(name);

        const applyCaseVariants = (n: string): string[] => {
            const v: string[] = [n];
            // to snake_case
            const snakeCase = n.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
            if (snakeCase !== n) v.push(snakeCase);
            // to camelCase
            const camelCase = n.replace(/_([a-z])/g, (_m: string, letter: string) => letter.toUpperCase());
            if (camelCase !== n) v.push(camelCase);
            return v;
        };

        const addPrefixVariants = (full: string) => {
            variants.add(full);
            if (!full.startsWith('integration.')) variants.add(`integration.${full}`);
            if (!full.startsWith('integrations.')) variants.add(`integrations.${full}`);
        };

        if (name.includes('.')) {
            const parts = name.split('.');
            const provider = parts[0];
            const method = parts.slice(1).join('.');

            // Try different cases for the method part
            for (const mv of applyCaseVariants(method)) {
                addPrefixVariants(`${provider}.${mv}`);
            }

            // If provider itself is an integration prefix, try removing it
            if (provider === 'integration' || provider === 'integrations') {
                const subName = parts.slice(1).join('.');
                if (subName.includes('.')) {
                    const subParts = subName.split('.');
                    const subProp = subParts[0];
                    const subMethod = subParts.slice(1).join('.');
                    for (const smv of applyCaseVariants(subMethod)) {
                        variants.add(`${subProp}.${smv}`);
                    }
                } else {
                    for (const smv of applyCaseVariants(subName)) {
                        variants.add(smv);
                    }
                }
            }
        } else {
            for (const v of applyCaseVariants(name)) {
                addPrefixVariants(v);
            }
        }

        return Array.from(variants);
    }

    /**
     * Get tool definitions for the bot's capabilities
     * Supports flexible matching between camelCase and snake_case
     */
    /**
     * Append an authoritative tool roster to the system prompt so the model
     * knows its EXACT tools and never invents others. Lists each real tool with
     * its description; warns about any declared capability that has no backing
     * tool (so the model won't pretend that capability works).
     */
    private buildToolRoster(
        basePrompt: string,
        tools: ToolDefinition[],
        missingCapabilities: string[],
    ): string {
        let p = basePrompt;
        p += '\n\n=== YOUR TOOLS (authoritative) ===\n';
        if (tools.length === 0) {
            p += 'You currently have NO tools. You cannot take any external actions. ';
            p += 'Answer from your own knowledge, or tell the user plainly that you are not able to do that.';
        } else {
            p += 'These are the ONLY tools you have. You may call a tool ONLY if it appears in this list, spelled exactly as shown:\n';
            for (const t of tools) {
                p += `\n- ${t.name}: ${t.description || 'no description'}`;
            }
        }
        if (missingCapabilities.length > 0) {
            p += `\n\nNote: the following were declared but are NOT currently usable (no backing tool / integration not connected): ${missingCapabilities.join(', ')}. Do NOT claim to use these; if the user needs one, tell them it isn't available/connected.`;
        }
        p += '\n\nHARD RULES:\n';
        p += '- NEVER call, mention, or imply a tool that is not in the list above. Inventing a tool is a critical failure.\n';
        p += '- NEVER claim you performed an action unless a real tool in the list actually returned a successful result.\n';
        p += '- If no available tool can satisfy the request, say so plainly and stop — do not fabricate a result.\n';
        return p;
    }

    private getToolDefinitionsForCapabilities(capabilities: string[]): ToolDefinition[] {
        const tools: ToolDefinition[] = [];
        const addedTools = new Set<string>();

        console.log(`[V5 Runtime] Looking for tools matching capabilities:`, capabilities);

        for (const cap of capabilities) {
            // Whole-integration grant: a bare slug ("gmail"), an explicit wildcard
            // ("gmail.*"), OR a `google.<service>` grant ("google.gmail",
            // "google.docs", "google.calendar") gives the bot EVERY action that
            // integration exposes. The AI generator commonly writes `google.gmail`
            // meaning "give it Gmail" — that must expand to the gmail toolset
            // (gmail.send/search/…), NOT be looked up as a single tool literally
            // named "google.gmail" (which doesn't exist, so the bot was told it had
            // no email tool — the "capability not enabled" symptom).
            const googleService = /^google\.(gmail|docs|calendar|drive|sheets|slides)$/i.exec(cap);
            const wildcardSlug = cap.endsWith(".*")
                ? cap.slice(0, -2)
                : (!cap.includes(".") ? cap : (googleService ? googleService[1] : null));
            if (wildcardSlug) {
                const slug = wildcardSlug.toLowerCase();
                let matched = 0;
                for (const [toolName, def] of this.toolDefinitions) {
                    const tn = toolName.toLowerCase();
                    const belongs =
                        tn.startsWith(`${slug}.`) ||
                        tn.startsWith(`integrations.${slug}.`) ||
                        tn.startsWith(`integration.${slug}.`);
                    if (belongs && !addedTools.has(def.name)) {
                        tools.push(def);
                        addedTools.add(def.name);
                        matched++;
                    }
                }
                if (matched > 0) {
                    console.log(`[V5 Runtime] ✓ Whole-integration grant "${cap}" → ${matched} ${slug} action(s)`);
                    continue;
                }
                // No prefix matches — fall through; it may be a single bare tool
                // (e.g. "say") resolved by exact/variant matching below.
            }

            // Try exact match first
            let def = this.toolDefinitions.get(cap);
            if (def && !addedTools.has(def.name)) {
                console.log(`[V5 Runtime] ✓ Found exact match for ${cap}: ${def.name}`);
                tools.push(def);
                addedTools.add(def.name);
                continue;
            }

            // Try normalized variants
            const variants = this.normalizeCapabilityName(cap);
            let found = false;
            for (const variant of variants) {
                def = this.toolDefinitions.get(variant);
                if (def && !addedTools.has(def.name)) {
                    console.log(`[V5 Runtime] ✓ Found variant match for ${cap} (${variant}): ${def.name}`);
                    tools.push(def);
                    addedTools.add(def.name);
                    found = true;
                    break;
                }
            }

            if (!found) {
                console.log(`[V5 Runtime] ✗ No tool found for capability: ${cap}`);
            }
        }

        return tools;
    }

    /**
     * Execute a tool call from AI
     */
    private async executeTool(name: string, args: Record<string, any>, context: ExecutionContext): Promise<any> {
        const fn = this.tools.get(name);
        if (!fn) {
            // The model hallucinated a tool that does not exist. NEVER return a
            // soft/null result here — that lets the model assume the call worked.
            // Return a hard, explicit error naming the ONLY real tools so it
            // corrects course (or tells the user it can't do this) instead of
            // pretending. `availableToolNames` is set per-run in execute().
            const available = this.availableToolNames.length
                ? this.availableToolNames.join(', ')
                : '(none — this bot has no tools)';
            const toolDefinition = this.toolDefinitions.get(name);
            const argumentNames = toolDefinition
                ? Object.keys(toolDefinition.parameters?.properties || {}).join(", ")
                : "";
            const error = `Tool "${name}" does not exist and was not called. You do NOT have this tool. Your ONLY available tools are: ${available}. Never invent or assume tools. Choose one of those exact names${argumentNames ? ` and use only these arguments: ${argumentNames}` : ""}. If none of the real tools can do this, tell the user plainly that you can't.`;
            const failure = { success: false, output: error };
            // This is a recoverable model mistake, not a failed agent run. Feed the
            // correction back into the ReAct loop so it can choose a real tool.
            // Marking it as a runtime error made channel bots return the generic
            // failure message even after the model successfully corrected itself.
            context.toolCalls.push({ tool: name, args, result: failure });
            return failure;
        }

        try {
            context.toolCalls.push({ tool: name, args });
            const result = await fn(args, context);

            // Store result in the last tool call
            const lastCall = context.toolCalls[context.toolCalls.length - 1];
            if (lastCall) {
                lastCall.result = result;
            }

            // Removed automatic formatting to context.output.
            // The AI will see the result in the conversation history and generate its own response.

            return result;
        } catch (e: any) {
            console.warn(`[V5 Runtime] Tool ${name} failed: ${e.message} - Feeding back to AI for self-healing.`);
            const failure = {
                success: false,
                output: `Tool execution failed with error: ${e.message}. Please recalibrate and try again with different parameters or a different tool.`
            };
            const lastCall = context.toolCalls[context.toolCalls.length - 1];
            if (lastCall) lastCall.result = failure;
            return failure;
        }
    }

    /**
     * Execute a block of statements (for hooks)
     */
    private async executeBlock(block: AST.BlockNode, context: ExecutionContext): Promise<void> {
        for (const stmt of block.statements) {
            await this.executeStatement(stmt, context);
        }
    }

    /**
     * Execute a statement or block
     */
    private async executeStatementOrBlock(node: AST.StatementNode | AST.BlockNode, context: ExecutionContext): Promise<void> {
        if (node.type === 'Block') {
            await this.executeBlock(node, context);
        } else {
            await this.executeStatement(node as AST.StatementNode, context);
        }
    }

    /**
     * Execute a single statement
     */
    private async executeStatement(stmt: AST.StatementNode, context: ExecutionContext): Promise<void> {
        try {
            switch (stmt.type) {
                case 'CallExpression':
                    const result = await this.executeTool(
                        stmt.tool,
                        await this.evaluateArguments(stmt.arguments, context),
                        context
                    );
                    if (stmt.outputVariable) {
                        context.variables[stmt.outputVariable] = result;
                    }
                    break;

                case 'SayStatement':
                    const message = await this.evaluateExpression(stmt.message, context);
                    // Tool calls return structured results ({ success, output, data }).
                    // A scripted V5 handler commonly does `result = call ...; say
                    // result`; String(result) produced "[object Object]" and hid
                    // the actual knowledge/integration response from the visitor.
                    context.output.push(typeof message === 'string' ? message : formatResultAsText(message));
                    break;

                case 'Assignment':
                    context.variables[stmt.variable] = await this.evaluateExpression(stmt.value, context);
                    break;

                case 'IfStatement':
                    const condition = await this.evaluateExpression(stmt.condition, context);
                    if (condition) {
                        await this.executeBlock(stmt.consequent, context);
                    } else if (stmt.alternate) {
                        if (stmt.alternate.type === 'Block') {
                            await this.executeBlock(stmt.alternate, context);
                        } else {
                            await this.executeStatement(stmt.alternate, context);
                        }
                    }
                    break;

                case 'LoopStatement':
                    const iterable = await this.evaluateExpression(stmt.iterable, context);
                    if (Array.isArray(iterable)) {
                        for (const item of iterable) {
                            context.variables[stmt.variable] = item;
                            await this.executeBlock(stmt.body, context);
                        }
                    }
                    break;

                case 'RespondStatement':
                    const responseMsg = await this.evaluateExpression(stmt.message, context);
                    context.output.push(typeof responseMsg === 'string' ? responseMsg : formatResultAsText(responseMsg));
                    break;

                case 'DelegateStatement': {
                    // Scripted delegation: `delegate to AgentName { task: ... }`.
                    // Evaluate params, build a task string, and run the sub-agent's loop.
                    const parentConfig = context.currentBotName
                        ? this.botConfigs.get(context.currentBotName)
                        : undefined;

                    if (!parentConfig) {
                        context.errors.push(`Cannot delegate to ${stmt.targetAgent}: no active bot config.`);
                        break;
                    }

                    const params = await this.evaluateArguments(stmt.params, context);
                    const task = typeof params.task === 'string'
                        ? params.task
                        : JSON.stringify(params);

                    const delegation = await this.executeDelegate(
                        stmt.targetAgent,
                        task,
                        context,
                        parentConfig,
                        0
                    );

                    // Make the result available to following statements.
                    const delegateResult = delegation.result ?? delegation.error;
                    context.variables[`${stmt.targetAgent}_result`] = delegateResult;
                    context.variables.last_delegation_result = delegateResult;
                    // `x = delegate to Agent ...` binds the result to `x`.
                    if (stmt.resultVariable) context.variables[stmt.resultVariable] = delegateResult;
                    break;
                }

                case 'RememberStatement':
                    const valueToStore = await this.evaluateExpression(stmt.value, context);
                    // Store in context memory (will be persisted by the runtime)
                    if (!context.memory) context.memory = {};
                    context.memory[stmt.key] = valueToStore;
                    break;

                case 'RecallStatement':
                    const recalledValue = context.memory?.[stmt.key] ??
                        (stmt.defaultValue ? await this.evaluateExpression(stmt.defaultValue, context) : null);
                    if (stmt.outputVariable) {
                        context.variables[stmt.outputVariable] = recalledValue;
                    }
                    break;

                case 'ForgetStatement':
                    if (context.memory) {
                        delete context.memory[stmt.key];
                    }
                    break;

                case 'ParallelBlock':
                    // Execute all statements in parallel with Promise.all
                    const timeout = stmt.timeout || 30000;
                    await Promise.race([
                        Promise.all(stmt.statements.map(s => this.executeStatement(s, context))),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Parallel block timeout')), timeout))
                    ]);
                    break;

                case 'PlanExecution':
                    // Execute a named plan with parameters
                    await this.executePlan(stmt, context);
                    break;

                case 'Checkpoint':
                    // Save/restore/clear checkpoint state
                    await this.executeCheckpoint(stmt, context);
                    break;

                case 'RetryConfig':
                    // Execute statement with retry logic
                    await this.executeWithRetry(stmt, context);
                    break;

                case 'While':
                    await this.executeWhile(stmt, context);
                    break;

                case 'Break':
                    throw new BreakException(stmt.label);

                case 'Match':
                    await this.executeMatch(stmt, context);
                    break;

                case 'Validate':
                    await this.executeValidate(stmt, context);
                    break;

                case 'Log':
                    await this.executeLog(stmt, context);
                    break;

                case 'Metric':
                    await this.executeMetric(stmt, context);
                    break;

                case 'Assert':
                    await this.executeAssert(stmt, context);
                    break;

                case 'Mask':
                    await this.executeMask(stmt, context);
                    break;

                case 'RateLimit':
                    await this.executeRateLimit(stmt, context);
                    break;

                case 'Transform':
                    await this.executeTransform(stmt, context);
                    break;
            }
        } catch (e: any) {
            context.errors.push(`Statement execution failed (${stmt.type}): ${e.message}`);
            throw e; // Re-throw for retry logic to catch
        }
    }
    private async evaluateArguments(args: Record<string, AST.ExpressionNode>, context: ExecutionContext): Promise<Record<string, any>> {
        const result: Record<string, any> = {};
        for (const [key, expr] of Object.entries(args)) {
            result[key] = await this.evaluateExpression(expr, context);
        }
        return result;
    }

    /**
     * Evaluate an expression
     */
    private async evaluateExpression(expr: AST.ExpressionNode, context: ExecutionContext): Promise<any> {
        switch (expr.type) {
            case 'Literal':
                return expr.value;

            case 'Identifier':
                return context.variables[expr.name] ?? null;

            case 'FString':
                return expr.template.replace(/\{([^}]+)\}/g, (_, key) => {
                    const parts = key.trim().split('.');
                    let value = context.variables[parts[0]];
                    for (let i = 1; i < parts.length && value != null; i++) {
                        value = value[parts[i]];
                    }
                    return value ?? '';
                });

            case 'BinaryExpression':
                const left = await this.evaluateExpression(expr.left, context);
                const right = await this.evaluateExpression(expr.right, context);
                return this.evaluateBinary(expr.operator, left, right);

            case 'ConditionalExpression':
                return (await this.evaluateExpression(expr.test, context))
                    ? await this.evaluateExpression(expr.consequent, context)
                    : await this.evaluateExpression(expr.alternate, context);

            case 'MemberExpression':
                const obj = await this.evaluateExpression(expr.object, context);
                if (obj == null) return null;

                if (expr.computed) {
                    const prop = await this.evaluateExpression(expr.property, context);
                    return obj[prop];
                } else {
                    const propName = (expr.property as AST.IdentifierNode).name;
                    return obj[propName];
                }

            case 'ArrayLiteral':
                const arr: any[] = [];
                for (const elem of expr.elements) {
                    arr.push(await this.evaluateExpression(elem, context));
                }
                return arr;

            case 'ObjectLiteral':
                const objResult: Record<string, any> = {};
                for (const [key, valExpr] of Object.entries(expr.properties)) {
                    objResult[key] = await this.evaluateExpression(valExpr, context);
                }
                return objResult;

            default:
                return null;
        }
    }

    /**
     * Evaluate binary expression
     */
    private evaluateBinary(operator: string, left: any, right: any): any {
        switch (operator) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return left / right;
            case '==': return left == right;
            case '!=': return left != right;
            case '>': return left > right;
            case '<': return left < right;
            case '>=': return left >= right;
            case '<=': return left <= right;
            case 'and': return left && right;
            case 'or': return left || right;
            case '??': return (left === null || left === undefined) ? right : left;
            case 'contains':
                if (typeof left === 'string' && typeof right === 'string') {
                    return left.toLowerCase().includes(right.toLowerCase());
                }
                return false;
            default:
                return null;
        }
    }

    /**
     * Execute a statement with retry logic and backoff
     */
    private async executeWithRetry(stmt: AST.RetryConfigNode, context: ExecutionContext): Promise<void> {
        const maxAttempts = stmt.maxAttempts;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.executeStatementOrBlock(stmt.targetStatement, context);
                return; // Success - exit retry loop
            } catch (e: any) {
                lastError = e;

                // Check if error is retryable
                if (stmt.retryOn && stmt.retryOn.length > 0) {
                    const errorType = e.name || e.message || 'unknown';
                    const shouldRetry = stmt.retryOn.some(type =>
                        errorType.toLowerCase().includes(type.toLowerCase())
                    );
                    if (!shouldRetry) {
                        throw e; // Not a retryable error
                    }
                }

                if (attempt < maxAttempts) {
                    const delay = this.calculateBackoff(attempt, stmt.backoff, stmt.baseDelay, stmt.maxDelay);
                    await this.sleep(delay);
                }
            }
        }

        // All retries exhausted
        if (stmt.fallback) {
            context.errors.push(`Primary action failed after ${maxAttempts} attempts: ${lastError?.message}`);
            await this.executeStatementOrBlock(stmt.fallback, context);
        } else {
            throw lastError;
        }
    }

    private calculateBackoff(attempt: number, strategy: string, baseDelay: number, maxDelay?: number): number {
        let delay: number;

        switch (strategy) {
            case 'exponential':
                delay = baseDelay * Math.pow(2, attempt - 1);
                break;
            case 'linear':
                delay = baseDelay * attempt;
                break;
            case 'fixed':
            default:
                delay = baseDelay;
                break;
        }

        if (maxDelay && delay > maxDelay) {
            delay = maxDelay;
        }

        return delay;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async executeWhile(stmt: AST.WhileNode, context: ExecutionContext): Promise<void> {
        while (await this.evaluateExpression(stmt.condition, context)) {
            try {
                await this.executeBlock(stmt.body, context);
            } catch (e: any) {
                if (e instanceof BreakException && (!stmt.label || e.label === stmt.label)) {
                    break;
                }
                throw e;
            }
        }
    }

    private async executeMatch(stmt: AST.MatchNode, context: ExecutionContext): Promise<void> {
        const value = await this.evaluateExpression(stmt.expression, context);

        for (const matchCase of stmt.cases) {
            const pattern = await this.evaluateExpression(matchCase.pattern, context);
            if (value === pattern) {
                await this.executeBlock(matchCase.body, context);
                return;
            }
        }

        if (stmt.defaultCase) {
            await this.executeBlock(stmt.defaultCase, context);
        }
    }

    private async executeValidate(stmt: AST.ValidateNode, context: ExecutionContext): Promise<void> {
        const value = await this.evaluateExpression(stmt.expression, context);

        // Simple validation - in production, use a proper schema validator
        let isValid = true;
        const errors: string[] = [];

        if (typeof stmt.schema === 'string') {
            // Schema reference - check if value matches expected type
            if (stmt.schema === 'string' && typeof value !== 'string') {
                isValid = false;
                errors.push(`Expected string, got ${typeof value}`);
            } else if (stmt.schema === 'number' && typeof value !== 'number') {
                isValid = false;
                errors.push(`Expected number, got ${typeof value}`);
            } else if (stmt.schema === 'boolean' && typeof value !== 'boolean') {
                isValid = false;
                errors.push(`Expected boolean, got ${typeof value}`);
            }
        } else if (typeof stmt.schema === 'object' && stmt.schema !== null) {
            // Inline schema object - check required fields
            for (const [key, expectedType] of Object.entries(stmt.schema)) {
                if (!(key in value)) {
                    isValid = false;
                    errors.push(`Missing required field: ${key}`);
                }
            }
        }

        if (stmt.errors) {
            context.variables[stmt.errors] = isValid ? [] : errors;
        }

        if (!isValid) {
            throw new Error(`Validation failed: ${errors.join(', ')}`);
        }
    }

    private async executeLog(stmt: AST.LogNode, context: ExecutionContext): Promise<void> {
        const message = await this.evaluateExpression(stmt.message, context);
        const metadata = stmt.metadata ? await this.evaluateArguments(stmt.metadata, context) : {};

        const logEntry = {
            level: stmt.level,
            message: String(message),
            timestamp: new Date().toISOString(),
            botName: context.currentBotName,
            ...metadata
        };

        // In production, send to logging service
        console.log(`[${logEntry.level.toUpperCase()}] ${logEntry.message}`, metadata);
        context.output.push(`[${logEntry.level}] ${logEntry.message}`);
    }

    private async executeMetric(stmt: AST.MetricNode, context: ExecutionContext): Promise<void> {
        const value = stmt.value ? await this.evaluateExpression(stmt.value, context) : 1;
        const tags = stmt.tags ? await this.evaluateArguments(stmt.tags, context) : {};

        const metric = {
            name: stmt.name,
            action: stmt.action,
            value,
            tags,
            timestamp: Date.now(),
            botName: context.currentBotName
        };

        // In production, send to metrics service
        console.log(`[METRIC] ${stmt.action} ${stmt.name}: ${value}`, tags);
    }

    private async executeAssert(stmt: AST.AssertNode, context: ExecutionContext): Promise<void> {
        const condition = await this.evaluateExpression(stmt.condition, context);

        if (!condition) {
            throw new Error(stmt.message || 'Assertion failed');
        }
    }

    private async executeMask(stmt: AST.MaskNode, context: ExecutionContext): Promise<void> {
        const value = await this.evaluateExpression(stmt.expression, context);
        const strValue = String(value);

        // Apply mask pattern
        // Pattern like "***-**-{last4}" or "{first4}-****-****-{last4}"
        let masked = stmt.pattern;

        // Replace {lastN} with last N characters
        const lastMatch = stmt.pattern.match(/\{last(\d+)\}/);
        if (lastMatch) {
            const n = parseInt(lastMatch[1], 10);
            const lastChars = strValue.slice(-n);
            masked = masked.replace(lastMatch[0], lastChars);
        }

        // Replace {firstN} with first N characters
        const firstMatch = stmt.pattern.match(/\{first(\d+)\}/);
        if (firstMatch) {
            const n = parseInt(firstMatch[1], 10);
            const firstChars = strValue.slice(0, n);
            masked = masked.replace(firstMatch[0], firstChars);
        }

        context.variables[stmt.outputVariable] = masked;
    }

    private async executeRateLimit(stmt: AST.RateLimitNode, context: ExecutionContext): Promise<void> {
        // In production, check against actual rate limit store (Redis, etc)
        const key = `ratelimit:${stmt.scope}:${context.currentBotName}`;

        // For now, just log the rate limit check
        console.log(`[RATE LIMIT] Checking ${stmt.maxRequests} per ${stmt.window} for ${stmt.scope}`);

        // Placeholder - actual implementation would check and potentially block
        // This is where you'd integrate with Redis or another rate limiting service
    }

    private async executeTransform(stmt: AST.TransformNode, context: ExecutionContext): Promise<void> {
        let data = await this.evaluateExpression(stmt.expression, context);

        for (const op of stmt.operations) {
            switch (op.type) {
                case 'map':
                    if (Array.isArray(data)) {
                        const mapConfig = op.config as any;
                        data = data.map(item => {
                            const mapped: any = {};
                            for (const [newKey, oldKey] of Object.entries(mapConfig)) {
                                mapped[newKey] = item[oldKey as string];
                            }
                            return mapped;
                        });
                    }
                    break;

                case 'filter':
                    if (Array.isArray(data)) {
                        const filterConfig = op.config as any;
                        data = data.filter(item => {
                            for (const [key, value] of Object.entries(filterConfig)) {
                                if (item[key] !== value) return false;
                            }
                            return true;
                        });
                    }
                    break;

                case 'pick':
                    if (typeof data === 'object' && data !== null) {
                        const pickConfig = op.config as string[];
                        const picked: any = {};
                        for (const key of pickConfig) {
                            if (key in data) picked[key] = data[key];
                        }
                        data = picked;
                    }
                    break;

                case 'omit':
                    if (typeof data === 'object' && data !== null) {
                        const omitConfig = op.config as string[];
                        const omitted: any = { ...data };
                        for (const key of omitConfig) {
                            delete omitted[key];
                        }
                        data = omitted;
                    }
                    break;

                case 'rename':
                    if (typeof data === 'object' && data !== null) {
                        const renameConfig = op.config as Record<string, string>;
                        const renamed: any = { ...data };
                        for (const [oldKey, newKey] of Object.entries(renameConfig)) {
                            if (oldKey in renamed) {
                                renamed[newKey] = renamed[oldKey];
                                delete renamed[oldKey];
                            }
                        }
                        data = renamed;
                    }
                    break;

                case 'compute':
                    // Custom computation - for now just pass through
                    break;
            }
        }

        context.variables[stmt.outputVariable] = data;
    }

    private async executeReAct(
        handler: AST.ReActHandlerNode,
        config: BotConfig,
        userMessage: string,
        context: ExecutionContext
    ): Promise<ExecutionContext> {
        const maxSteps = handler.maxSteps || 10;
        const tools = this.getToolDefinitionsForCapabilities(config.capabilities);

        const systemPrompt = `${config.systemPrompt}

You are now in ReAct (Reasoning + Acting) mode. For each step:
1. THINK: Analyze the current state and decide what to do
2. ACT: Choose a tool and provide arguments
3. OBSERVE: Process the result and decide next step

Continue until you have a final answer or reach max steps (${maxSteps}).

Format your response as:
Thought: [your reasoning]
Action: [tool name]
Action Input: { "param": "value" }

Or when done:
Final Answer: [your response]`;

        let step = 0;
        let conversation = `Task: ${userMessage}\n\nStep ${step + 1}:\n`;

        while (step < maxSteps) {
            step++;

            try {
                // ReAct bakes the running trace into a single prompt string, so we
                // hand it to the model as one user message (aiCall expects a
                // messages array, not a bare string).
                const response = await this.aiCall(systemPrompt, [{ role: 'user', content: conversation }], tools);

                if (!response.content) {
                    context.errors.push('Empty AI response in ReAct loop');
                    break;
                }

                const content = response.content;

                // Check for final answer
                if (content.includes('Final Answer:')) {
                    const finalAnswer = content.split('Final Answer:')[1].trim();
                    context.output.push(finalAnswer);
                    break;
                }

                // Parse Thought, Action, Action Input
                const thoughtMatch = content.match(/Thought:\s*(.+?)(?=\nAction:|$)/is);
                const actionMatch = content.match(/Action:\s*(\S+)/i);
                const actionInputMatch = content.match(/Action Input:\s*(\{[\s\S]*\}|\[[\s\S]*\])/);

                const thought = thoughtMatch?.[1]?.trim() || 'No thought provided';
                const action = actionMatch?.[1]?.trim();
                let actionInput: Record<string, any> = {};

                try {
                    if (actionInputMatch) {
                        actionInput = JSON.parse(actionInputMatch[1]);
                    }
                } catch {
                    actionInput = { raw: actionInputMatch?.[1] || '' };
                }

                if (!action) {
                    context.output.push(content); // No action, treat as response
                    break;
                }

                // Execute the tool
                const result = await this.executeTool(action, actionInput, context);

                // Add to conversation for next iteration
                conversation += `Thought: ${thought}\nAction: ${action}\nAction Input: ${JSON.stringify(actionInput)}\nObservation: ${JSON.stringify(result)}\n\nStep ${step + 1}:\n`;

            } catch (e: any) {
                context.errors.push(`ReAct step ${step} failed: ${e.message}`);
                break;
            }
        }

        if (step >= maxSteps && context.output.length === 0) {
            context.errors.push('ReAct max steps reached without conclusion');
        }

        // Execute after hook
        if (config.afterHook) {
            await this.executeBlock(config.afterHook, context);
        }

        return context;
    }

    /**
     * Execute Tree of Thoughts (explore multiple reasoning paths)
     */
    private async executeTreeOfThoughts(
        handler: AST.TreeOfThoughtsHandlerNode,
        config: BotConfig,
        userMessage: string,
        context: ExecutionContext
    ): Promise<ExecutionContext> {
        const maxDepth = handler.maxDepth || 5;
        const branchFactor = handler.branchFactor || 3;
        const tools = this.getToolDefinitionsForCapabilities(config.capabilities);

        const systemPrompt = `${config.systemPrompt}

You are in Tree-of-Thoughts mode. For each step:
1. Generate ${branchFactor} different approaches/thoughts about how to solve this
2. Score each approach (1-10) based on likelihood of success
3. Choose the best approach and execute it
4. Continue until solved or max depth reached (${maxDepth})

Return JSON array of candidates like:
[{"thought": "reasoning", "action": "toolName", "actionInput": {}, "score": 8}]`;

        let depth = 0;
        let history: { thought: string; action: string; observation: any }[] = [];

        while (depth < maxDepth) {
            depth++;

            const prompt = `Task: ${userMessage}\n\nHistory:\n${history.map((h, i) =>
                `Step ${i + 1}: ${h.thought} → Action: ${h.action} → ${JSON.stringify(h.observation)}`
            ).join('\n')}\n\nGenerate ${branchFactor} candidate next steps.`;

            try {
                // ToT builds the full prompt (task + history) as a string; pass it
                // as a single user message (aiCall expects a messages array).
                const response = await this.aiCall(systemPrompt, [{ role: 'user', content: prompt }], tools);

                // Parse candidates (simplified - in production use structured output)
                let candidates: Array<{ thought: string; action: string; actionInput: any; score?: number }> = [];

                try {
                    const jsonMatch = response.content?.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        candidates = JSON.parse(jsonMatch[0]);
                    }
                } catch {
                    // Fallback: single candidate from content
                    candidates = [{ thought: response.content || 'Direct answer', action: 'general.respond', actionInput: { prompt: response.content } }];
                }

                // Score and select best (or use provided scores)
                const best = candidates.sort((a, b) => (b.score || 5) - (a.score || 5))[0];

                if (!best) {
                    context.errors.push('No valid candidates generated');
                    break;
                }

                // Execute best action
                const observation = await this.executeTool(best.action, best.actionInput, context);
                history.push({ thought: best.thought, action: best.action, observation });

                // Check if we have an answer
                if (best.action === 'general.respond' || best.action === 'final') {
                    break;
                }

            } catch (e: any) {
                context.errors.push(`ToT depth ${depth} failed: ${e.message}`);
                break;
            }
        }

        // Execute after hook
        if (config.afterHook) {
            await this.executeBlock(config.afterHook, context);
        }

        return context;
    }

    /**
     * Execute a named plan
     */
    private async executePlan(stmt: AST.PlanExecutionNode, context: ExecutionContext): Promise<void> {
        const botName = context.currentBotName || 'default';
        const bot = this.getBotAST(botName);

        if (!bot || !bot.plans) {
            context.errors.push(`No plans available for bot`);
            return;
        }

        const plan = bot.plans.find(p => p.name === stmt.planName);
        if (!plan) {
            context.errors.push(`Plan not found: ${stmt.planName}`);
            return;
        }

        // Merge plan inputs with provided params
        const evaluatedParams: Record<string, any> = {};
        for (const [key, expr] of Object.entries(stmt.params)) {
            evaluatedParams[key] = await this.evaluateExpression(expr, context);
        }

        // Set plan inputs as variables
        for (const input of plan.inputs) {
            context.variables[input] = evaluatedParams[input];
        }

        // Handle resume from checkpoint
        if (stmt.resumeFrom && context.checkpoints?.[stmt.resumeFrom]) {
            // Restore checkpoint state
            Object.assign(context.variables, context.checkpoints[stmt.resumeFrom]);
        }

        // Execute plan body
        await this.executeBlock(plan.body, context);
    }

    /**
     * Execute checkpoint save/restore/clear
     */
    private async executeCheckpoint(stmt: AST.CheckpointNode, context: ExecutionContext): Promise<void> {
        if (!context.checkpoints) {
            context.checkpoints = {};
        }

        switch (stmt.action) {
            case 'save':
                // Save current variable state
                context.checkpoints[stmt.name] = { ...context.variables };
                break;
            case 'restore':
                // Restore saved state
                if (context.checkpoints[stmt.name]) {
                    Object.assign(context.variables, context.checkpoints[stmt.name]);
                } else {
                    context.errors.push(`Checkpoint not found: ${stmt.name}`);
                }
                break;
            case 'clear':
                // Remove checkpoint
                delete context.checkpoints[stmt.name];
                break;
        }
    }

    /**
     * Get all loaded bot names
     */
    getBotNames(): string[] {
        return Array.from(this.botConfigs.keys());
    }

    /**
     * Get a bot's configuration
     */
    getBotConfig(name: string): BotConfig | undefined {
        return this.botConfigs.get(name);
    }
}

// ============ Export Convenience ============

export { parseHiveLang } from './parser';
