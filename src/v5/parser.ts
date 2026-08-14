/**
 * HiveLang v5 Parser - AI-First Architecture
 *
 * Parses curly-brace syntax:
 *
 * bot DevGenius {
 *     description: "Your AI developer assistant"
 *
 *     capabilities {
 *         github.listRepos
 *         code.analyze
 *     }
 *
 *     instructions {
 *         You are DevGenius, an expert developer assistant.
 *         Always explain your reasoning.
 *     }
 * }
 */

import { Token, TokenType, Tokenizer } from './tokenizer';
import * as AST from './ast';
import { HiveLangDiagnostic, validateProgram } from './validation';

export interface ParseResult {
    program: AST.ProgramNode;
    errors: string[];
    diagnostics: HiveLangDiagnostic[];
}

export class Parser {
    private tokens: Token[];
    private current = 0;
    private errors: string[] = [];
    private source: string;

    constructor(tokens: Token[], source: string = '') {
        this.tokens = tokens;
        this.source = source;
    }

    parse(): ParseResult {
        const bots: AST.BotDefinitionNode[] = [];
        const imports: AST.ImportNode[] = [];

        while (!this.isAtEnd()) {
            try {
                if (this.matchKeyword('import')) {
                    imports.push(this.parseImport());
                } else if (this.matchKeyword('bot')) {
                    bots.push(this.parseBot());
                } else if (this.matchKeyword('agent')) {
                    // Top-level agent without a bot - wrap in implicit bot
                    const agent = this.parseAgent();
                    bots.push({
                        type: 'BotDefinition',
                        name: agent.name,
                        capabilities: agent.capabilities,
                        agents: [agent]
                    });
                } else if (this.matchKeyword('swarm')) {
                    // Swarm is just a bot with multiple agents
                    bots.push(this.parseSwarm());
                } else {
                    this.reportUnexpected('top-level declaration');
                    this.advance();
                }
            } catch (e: any) {
                this.errors.push(this.formatError(e));
                this.synchronize();
            }
        }

        for (const bot of bots) {
            if (bot.grounding?.knowledge === 'required' && !bot.capabilities.includes('knowledge.search')) {
                this.errors.push(`Bot ${bot.name}: grounding requires the knowledge.search capability.`);
            }
        }

        const program = { type: 'Program' as const, bots, imports };
        const diagnostics = validateProgram(program);
        this.errors.push(...diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.message));
        return { program, errors: this.errors, diagnostics };
    }

    // ============ Top-Level Parsing ============

    private parseImport(): AST.ImportNode {
        // eslint-disable-next-line @next/next/no-assign-module-variable
        const module = this.consume('IDENTIFIER', "Expected module name after 'import'").value;
        return { type: 'Import', module };
    }

    private parseBot(): AST.BotDefinitionNode {
        const name = this.consume('IDENTIFIER', "Expected bot name").value;

        const bot: AST.BotDefinitionNode = {
            type: 'BotDefinition',
            name,
            capabilities: [],
            agents: [],
            events: []
        };

        if (this.match('PUNCTUATION', '{')) {
            this.parseBotBody(bot);
            this.consume('PUNCTUATION', '}', "Expected '}' to close bot definition");
        }

        return bot;
    }

    private parseSwarm(): AST.BotDefinitionNode {
        // swarm "Name" { ... } OR swarm Name { ... }
        let name: string;
        if (this.check('STRING')) {
            name = this.advance().value;
        } else {
            name = this.consume('IDENTIFIER', "Expected swarm name").value;
        }

        const bot: AST.BotDefinitionNode = {
            type: 'BotDefinition',
            name,
            capabilities: [],
            agents: [],
            events: []
        };

        if (this.match('PUNCTUATION', '{')) {
            this.parseBotBody(bot);
            this.consume('PUNCTUATION', '}', "Expected '}' to close swarm definition");
        }

        return bot;
    }

    private parseBotBody(bot: AST.BotDefinitionNode) {
        while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
            if (this.matchKeyword('description')) {
                this.match('PUNCTUATION', ':'); // Optional colon
                if (this.check('STRING')) {
                    bot.description = this.advance().value;
                }
            } else if (this.matchKeyword('instructions')) {
                bot.instructions = this.parseTextBlock();
            } else if (this.matchKeyword('capabilities')) {
                bot.capabilities = this.parseCapabilitiesList();
            } else if (this.matchKeyword('grounding')) {
                bot.grounding = this.parseGrounding();
            } else if (this.matchKeyword('memory')) {
                bot.memoryPolicy = this.parseMemoryPolicy();
            } else if (this.matchKeyword('agent')) {
                bot.agents!.push(this.parseAgent());
            } else if (this.matchKeyword('before')) {
                if (this.matchKeyword('input')) {
                    bot.beforeHook = this.parseBlockBody();
                }
            } else if (this.matchKeyword('after')) {
                if (this.matchKeyword('response')) {
                    bot.afterHook = this.parseBlockBody();
                }
            } else if (this.matchKeyword('on')) {
                bot.events!.push(this.parseEventHandler());
            } else if (this.matchKeyword('plan')) {
                bot.plans = bot.plans || [];
                bot.plans.push(this.parsePlan());
            } else if (this.matchKeyword('schedule')) {
                bot.schedules = bot.schedules || [];
                bot.schedules.push(this.parseSchedule());
            } else if (this.matchKeyword('webhook')) {
                bot.webhooks = bot.webhooks || [];
                bot.webhooks.push(this.parseWebhook());
            } else if (this.matchKeyword('react')) {
                bot.reactHandlers = bot.reactHandlers || [];
                bot.reactHandlers.push(this.parseReactHandler());
            } else if (this.matchKeyword('treeOfThoughts') || this.matchKeyword('tot')) {
                bot.totHandlers = bot.totHandlers || [];
                bot.totHandlers.push(this.parseTotHandler());
            } else {
                // Skip unknown tokens in bot body
                this.reportUnexpected('bot body');
                this.advance();
            }
        }
    }

    private parseGrounding(): AST.GroundingNode {
        const grounding: AST.GroundingNode = { knowledge: 'optional', citeSources: false };
        if (!this.match('PUNCTUATION', '{')) return grounding;
        while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
            const key = this.advance().value;
            this.match('PUNCTUATION', ':');
            if (key === 'knowledge') {
                const value = this.advance().value;
                if (value === 'required' || value === 'optional' || value === 'off') grounding.knowledge = value;
            } else if (key === 'cite_sources') {
                grounding.citeSources = this.advance().value === 'true';
            } else if (key === 'on_missing') {
                const value = this.advance().value;
                if (value === 'say_uncertain' || value === 'ask_clarifying_question') grounding.onMissing = value;
            }
        }
        this.consume('PUNCTUATION', '}', "Expected '}' to close grounding");
        return grounding;
    }

    private parseMemoryPolicy(): AST.MemoryPolicyNode {
        const policy: AST.MemoryPolicyNode = { mode: 'session', rememberOnly: [], neverRemember: [] };
        if (!this.match('PUNCTUATION', '{')) return policy;
        const readList = () => {
            const values: string[] = [];
            if (!this.match('PUNCTUATION', '[')) return values;
            while (!this.check('PUNCTUATION', ']') && !this.isAtEnd()) {
                if (this.check('IDENTIFIER') || this.check('KEYWORD') || this.check('STRING')) values.push(this.advance().value);
                else this.advance();
                this.match('PUNCTUATION', ',');
            }
            this.consume('PUNCTUATION', ']', "Expected ']' to close memory list");
            return values;
        };
        while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
            const key = this.advance().value;
            this.match('PUNCTUATION', ':');
            if (key === 'mode') {
                const value = this.advance().value;
                if (value === 'none' || value === 'session' || value === 'durable') policy.mode = value;
            } else if (key === 'ttl') policy.ttl = this.advance().value;
            else if (key === 'remember_only') policy.rememberOnly = readList();
            else if (key === 'never_remember') policy.neverRemember = readList();
        }
        this.consume('PUNCTUATION', '}', "Expected '}' to close memory");
        return policy;
    }

    private parseAgent(): AST.AgentDefinitionNode {
        const name = this.consume('IDENTIFIER', "Expected agent name").value;

        const agent: AST.AgentDefinitionNode = {
            type: 'AgentDefinition',
            name,
            capabilities: []
        };

        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                if (this.matchKeyword('role') || this.matchKeyword('system_prompt')) {
                    this.match('PUNCTUATION', ':');
                    if (this.check('STRING')) {
                        agent.role = this.advance().value;
                    }
                } else if (this.matchKeyword('capabilities')) {
                    agent.capabilities = this.parseCapabilitiesList();
                } else if (this.matchKeyword('on')) {
                    // Agent has event handlers
                    const event = this.parseEventHandler();
                    // Store in body
                    if (!agent.body) {
                        agent.body = { type: 'Block', statements: [] };
                    }
                } else {
                    this.reportUnexpected('capability list');
                    this.advance();
                }
            }
            this.consume('PUNCTUATION', '}', "Expected '}' to close agent definition");
        }

        return agent;
    }

    // ============ Block Parsing ============

    private parseTextBlock(): string {
        // instructions { ... } or instructions: "..."
        if (this.match('PUNCTUATION', ':')) {
            if (this.check('STRING')) {
                return this.advance().value;
            }
        }

        if (this.match('PUNCTUATION', '{')) {
            // Find the matching closing brace by tracking depth
            let braceDepth = 1;
            const contentTokens: Token[] = [];

            while (braceDepth > 0 && !this.isAtEnd()) {
                const token = this.peek();

                if (token.type === 'PUNCTUATION' && token.value === '{') {
                    braceDepth++;
                } else if (token.type === 'PUNCTUATION' && token.value === '}') {
                    braceDepth--;
                }

                if (braceDepth > 0) {
                    contentTokens.push(token);
                    this.advance();
                }
            }

            if (braceDepth !== 0) {
                throw new Error("Expected '}' to close text block");
            }

            // Consume the closing brace
            this.advance();

            // Token source offsets make this O(1) and preserve original formatting.
            if (this.source && contentTokens.length > 0) {
                const firstToken = contentTokens[0];
                const lastToken = contentTokens[contentTokens.length - 1];
                if (firstToken.start >= 0 && lastToken.end > firstToken.start && lastToken.end <= this.source.length) {
                    return this.source.substring(firstToken.start, lastToken.end).trim();
                }
            }

            // Fallback: reconstruct from tokens (may lose formatting)
            return contentTokens.map(t => t.value).join(' ').trim();
        }

        return '';
    }

    private parseCapabilitiesList(): string[] {
        const capabilities: string[] = [];

        // Tolerate an optional colon: `capabilities: [...]` as well as `capabilities {...}`.
        this.match('PUNCTUATION', ':');

        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                // Parse capability: module.function or just function
                if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                    let cap = this.advance().value;
                    while (this.match('PUNCTUATION', '.')) {
                        if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                            cap += '.' + this.advance().value;
                        }
                    }
                    capabilities.push(cap);
                } else if (this.check('PUNCTUATION', '-') || this.check('OPERATOR', '-')) {
                    // Handle bullet-point style: - github.listRepos
                    this.advance(); // consume '-'
                } else {
                    this.advance();
                }
            }
            this.consume('PUNCTUATION', '}', "Expected '}' to close capabilities");
        } else if (this.match('PUNCTUATION', '[')) {
            // Handle array style, both bare and quoted:
            //   [github.listRepos, code.analyze]  and  ["web.search", "ai.generate"]
            while (!this.check('PUNCTUATION', ']') && !this.isAtEnd()) {
                if (this.check('STRING')) {
                    // Quoted capability — already a complete dotted name.
                    capabilities.push(this.advance().value);
                } else if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                    let cap = this.advance().value;
                    while (this.match('PUNCTUATION', '.')) {
                        if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                            cap += '.' + this.advance().value;
                        }
                    }
                    capabilities.push(cap);
                } else {
                    this.reportUnexpected('capability list');
                    this.advance(); // skip stray punctuation
                }
                this.match('PUNCTUATION', ','); // Optional comma
            }
            this.consume('PUNCTUATION', ']', "Expected ']' to close capabilities");
        }

        return capabilities;
    }

    private parseEventHandler(): AST.EventHandlerNode {
        // on github.push { ... } or on schedule.daily { ... }
        let event = '';

        if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
            event = this.advance().value;
            while (this.match('PUNCTUATION', '.')) {
                if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                    event += '.' + this.advance().value;
                }
            }
        }

        const body = this.parseBlockBody();

        return { type: 'EventHandler', event, body };
    }

    private parseReactHandler(): AST.ReActHandlerNode {
        // react on "troubleshoot *" with maxSteps 8 { ... }
        this.consumeKeyword('on', "Expected 'on' after 'react'");
        const trigger = this.consume('STRING', "Expected trigger pattern").value;

        let maxSteps = 10;
        if (this.matchKeyword('with')) {
            if (this.matchKeyword('maxSteps')) {
                this.match('PUNCTUATION', ':'); // Optional colon
                maxSteps = parseInt(this.consume('NUMBER', "Expected number").value, 10);
            }
        }

        const body = this.parseBlockBody();
        return { type: 'ReActHandler', trigger, maxSteps, body };
    }

    private parseTotHandler(): AST.TreeOfThoughtsHandlerNode {
        // treeOfThoughts on "why isn't * working" with depth 4, branch 3 { ... }
        this.consumeKeyword('on', "Expected 'on' after 'treeOfThoughts'");
        const trigger = this.consume('STRING', "Expected trigger pattern").value;

        let maxDepth = 5;
        let branchFactor = 3;

        if (this.matchKeyword('with')) {
            // Parse optional depth and branch parameters
            while (!this.check('PUNCTUATION', '{') && !this.isAtEnd()) {
                if (this.matchKeyword('depth')) {
                    this.match('PUNCTUATION', ':');
                    maxDepth = parseInt(this.consume('NUMBER', "Expected number").value, 10);
                } else if (this.matchKeyword('branch') || this.matchKeyword('branchFactor')) {
                    this.match('PUNCTUATION', ':');
                    branchFactor = parseInt(this.consume('NUMBER', "Expected number").value, 10);
                }
                this.match('PUNCTUATION', ','); // Optional comma between params
            }
        }

        const body = this.parseBlockBody();
        return { type: 'TreeOfThoughtsHandler', trigger, maxDepth, branchFactor, body };
    }

    private parseBlockBody(): AST.BlockNode {
        const statements: AST.StatementNode[] = [];

        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                const stmt = this.parseStatement();
                if (stmt) {
                    statements.push(stmt);
                } else {
                    // If parseStatement returns null, we hit an unknown token
                    // Skip it to avoid infinite loop
                    if (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                        this.reportUnexpected('statement');
                        this.advance();
                    }
                }
            }
            this.consume('PUNCTUATION', '}', "Expected '}' to close block");
        }

        return { type: 'Block', statements };
    }

    // ============ Statement Parsing ============

    private parseStatement(): AST.StatementNode | null {
        if (this.matchKeyword('retry')) return this.parseRetry();
        if (this.matchKeyword('call')) return this.parseCall();
        if (this.matchKeyword('say')) return this.parseSay();
        if (this.matchKeyword('respond')) return this.parseRespond();
        if (this.matchKeyword('if')) return this.parseIf();
        if (this.matchKeyword('loop') || this.matchKeyword('for')) return this.parseLoop();
        if (this.matchKeyword('while')) return this.parseWhile();
        if (this.matchKeyword('break')) return this.parseBreak();
        if (this.matchKeyword('return')) return this.parseReturn();
        if (this.matchKeyword('delegate')) return this.parseDelegate();
        if (this.matchKeyword('remember')) return this.parseRemember();
        if (this.matchKeyword('recall')) return this.parseRecall();
        if (this.matchKeyword('forget')) return this.parseForget();
        if (this.matchKeyword('parallel')) return this.parseParallel();
        if (this.matchKeyword('checkpoint')) return this.parseCheckpoint();
        if (this.matchKeyword('execute')) return this.parsePlanExecution();
        if (this.matchKeyword('match')) return this.parseMatch();
        if (this.matchKeyword('validate')) return this.parseValidate();
        if (this.matchKeyword('log')) return this.parseLog();
        if (this.matchKeyword('metric')) return this.parseMetric();
        if (this.matchKeyword('assert')) return this.parseAssert();
        if (this.matchKeyword('mask')) return this.parseMask();
        if (this.matchKeyword('rateLimit')) return this.parseRateLimit();
        if (this.matchKeyword('transform')) return this.parseTransform();

        // Variable assignment: name = value. NOTE: the tokenizer emits `=` as an
        // OPERATOR (not PUNCTUATION) — checking for PUNCTUATION here meant NO
        // assignment ever matched, so `x = ...` statements were silently dropped.
        // A reserved word (e.g. `response`, `input`) is also a legal LHS target —
        // the AI generator emits `response = call ...`; without allowing KEYWORD
        // here the assignment is skipped, the tokens mis-parse, and the whole bot
        // fails with "Expected variable name".
        if ((this.check('IDENTIFIER') || this.check('KEYWORD')) && this.checkNext('OPERATOR', '=')) {
            return this.parseAssignment();
        }

        // Unknown token - don't advance, let caller handle it
        // This allows proper handling of closing braces and other delimiters
        return null;
    }

    private parseCall(): AST.CallExpressionNode {
        let tool = this.consume('IDENTIFIER', "Expected tool name").value;

        // Handle dot notation. After a `.`, the method segment is unambiguously an
        // identifier even when the word is a reserved keyword — `ai.respond`,
        // `email.respond`, `x.as` etc. are all valid tool paths. Without accepting
        // KEYWORD here, any capability whose method name collides with a HiveLang
        // keyword (respond/say/call/…) throws "Expected method name" and the whole
        // bot fails to run. (Same class as the member-access fix; the AI generator
        // legitimately emits `ai.respond`/`email.respond`.)
        while (this.match('PUNCTUATION', '.')) {
            const seg = this.check('KEYWORD') ? this.advance() : this.consume('IDENTIFIER', "Expected method name");
            tool += '.' + seg.value;
        }

        let args: Record<string, AST.ExpressionNode> = {};
        if (this.matchKeyword('with')) {
            args = this.parseArguments();
        }

        let outputVariable: string | undefined;
        if (this.matchKeyword('as')) {
            // `as response` — the bind target may be a reserved word too.
            outputVariable = (this.check('KEYWORD') ? this.advance() : this.consume('IDENTIFIER', "Expected variable name")).value;
        }

        return { type: 'CallExpression', tool, arguments: args, outputVariable };
    }

    private parseSay(): AST.SayStatementNode {
        // say can have an optional message expression
        // If next token is a closing brace or another statement keyword, use empty string
        let message: AST.ExpressionNode;

        if (this.check('PUNCTUATION', '}') || this.isStatementKeyword()) {
            // No message provided, use empty string
            message = { type: 'Literal', value: '', raw: '""' };
        } else {
            message = this.parseExpression();
        }

        return { type: 'SayStatement', message };
    }

    private parseRespond(): AST.RespondStatementNode {
        // respond can optionally have "with message"
        let message: AST.ExpressionNode = { type: 'Literal', value: '', raw: '""' };

        if (this.matchKeyword('with')) {
            message = this.parseExpression();
        } else if (!this.check('PUNCTUATION', '}') && !this.isStatementKeyword()) {
            // If there's an expression following, parse it
            message = this.parseExpression();
        }

        return { type: 'RespondStatement', message };
    }

    private isStatementKeyword(): boolean {
        if (!this.check('KEYWORD')) return false;
        const kw = this.peek().value;
        return ['retry', 'call', 'say', 'respond', 'if', 'loop', 'for', 'while',
                'break', 'return', 'delegate', 'remember', 'recall', 'parallel',
                'checkpoint', 'execute', 'match', 'validate', 'log', 'metric',
                'assert', 'mask', 'rateLimit', 'transform'].includes(kw);
    }

    private parseIf(): AST.IfStatementNode {
        // Handle: if (condition) { ... } OR if condition { ... }
        this.match('PUNCTUATION', '('); // Optional parens
        const condition = this.parseExpression();
        this.match('PUNCTUATION', ')'); // Optional parens

        const consequent = this.parseBlockBody();
        let alternate: AST.BlockNode | AST.IfStatementNode | undefined;

        if (this.matchKeyword('else')) {
            if (this.matchKeyword('if')) {
                alternate = this.parseIf();
            } else {
                alternate = this.parseBlockBody();
            }
        }

        return { type: 'IfStatement', condition, consequent, alternate };
    }

    private parseLoop(): AST.LoopStatementNode {
        // Accept both `for x in y { }` and the parenthesized `for (x in y) { }`
        // form (the AI generator emits both). The parens are optional syntactic
        // sugar around the same `<var> in <iterable>` header.
        const paren = this.match('PUNCTUATION', '(');
        // The loop variable may be a reserved word (same tolerance as assignment
        // targets) — accept KEYWORD as well as IDENTIFIER.
        const variable = (this.check('KEYWORD') ? this.advance() : this.consume('IDENTIFIER', "Expected loop variable")).value;
        this.consumeKeyword('in', "Expected 'in' after loop variable");
        const iterable = this.parseExpression();
        if (paren) this.consume('PUNCTUATION', ')', "Expected ')' to close loop header");
        const body = this.parseBlockBody();

        return { type: 'LoopStatement', variable, iterable, body };
    }

    private parseReturn(): AST.ReturnStatementNode {
        let value: AST.ExpressionNode | undefined;
        if (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
            value = this.parseExpression();
        }
        return { type: 'ReturnStatement', value };
    }

    private parseDelegate(): AST.DelegateStatementNode {
        this.consumeKeyword('to', "Expected 'to' after 'delegate'");

        let targetAgent: string;
        if (this.check('STRING')) {
            targetAgent = this.advance().value;
        } else {
            targetAgent = this.consume('IDENTIFIER', "Expected agent name").value;
        }

        let params: Record<string, AST.ExpressionNode> = {};
        if (this.matchKeyword('with')) {
            params = this.parseArguments();
        }

        return { type: 'DelegateStatement', targetAgent, params };
    }

    private parsePlan(): AST.PlanNode {
        // plan OnboardingGuide {
        //     description: "Helps new users get started"
        //     inputs: [userName, companyName]
        //     checkpoints: [step1, step2, complete]
        //     { ... }
        // }
        const name = this.consume('IDENTIFIER', "Expected plan name").value;

        let description: string | undefined;
        const inputs: string[] = [];
        const checkpoints: string[] = [];

        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                if (this.matchKeyword('description')) {
                    this.match('PUNCTUATION', ':');
                    description = this.consume('STRING', "Expected description").value;
                } else if (this.matchKeyword('inputs')) {
                    this.match('PUNCTUATION', ':');
                    if (this.match('PUNCTUATION', '[')) {
                        while (!this.check('PUNCTUATION', ']') && !this.isAtEnd()) {
                            if (this.check('IDENTIFIER')) {
                                inputs.push(this.advance().value);
                            }
                            this.match('PUNCTUATION', ',');
                        }
                        this.consume('PUNCTUATION', ']', "Expected ']' after inputs");
                    }
                } else if (this.matchKeyword('checkpoints')) {
                    this.match('PUNCTUATION', ':');
                    if (this.match('PUNCTUATION', '[')) {
                        while (!this.check('PUNCTUATION', ']') && !this.isAtEnd()) {
                            if (this.check('IDENTIFIER') || this.check('STRING')) {
                                checkpoints.push(this.advance().value);
                            }
                            this.match('PUNCTUATION', ',');
                        }
                        this.consume('PUNCTUATION', ']', "Expected ']' after checkpoints");
                    }
                } else if (this.check('PUNCTUATION', '{')) {
                    // Body starts - break to parse below
                    break;
                } else {
                    this.advance();
                }
            }
        }

        const body = this.parseBlockBody();
        return { type: 'Plan', name, description, inputs, checkpoints, body };
    }

    private parsePlanExecution(): AST.PlanExecutionNode {
        // execute OnboardingGuide with { userName: "John", companyName: "Acme" }
        // or: execute OnboardingGuide resume from step2 with { ... }
        const planName = this.consume('IDENTIFIER', "Expected plan name").value;

        let resumeFrom: string | undefined;
        if (this.matchKeyword('resume')) {
            this.consumeKeyword('from', "Expected 'from' after 'resume'");
            resumeFrom = this.consume('IDENTIFIER', "Expected checkpoint name").value;
        }

        let params: Record<string, AST.ExpressionNode> = {};
        if (this.matchKeyword('with')) {
            params = this.parseArguments();
        }

        return { type: 'PlanExecution', planName, params, resumeFrom };
    }

    private parseCheckpoint(): AST.CheckpointNode {
        // checkpoint save "step1" or checkpoint restore "step1" or checkpoint clear "step1"
        let action: 'save' | 'restore' | 'clear' = 'save';

        if (this.matchKeyword('save')) {
            action = 'save';
        } else if (this.matchKeyword('restore')) {
            action = 'restore';
        } else if (this.matchKeyword('clear')) {
            action = 'clear';
        }

        let name: string;
        if (this.check('STRING')) {
            name = this.advance().value;
        } else {
            name = this.consume('IDENTIFIER', "Expected checkpoint name").value;
        }

        let scope: 'local' | 'global' | 'persistent' = 'local';
        if (this.matchKeyword('scope')) {
            const scopeVal = this.consume('IDENTIFIER', "Expected scope").value;
            if (scopeVal === 'global' || scopeVal === 'persistent') {
                scope = scopeVal;
            }
        }

        return { type: 'Checkpoint', name, action, scope };
    }

    private parseAssignment(): AST.StatementNode {
        // LHS may be a reserved word (see parseStatement) — accept KEYWORD as the
        // assignment target, not just IDENTIFIER.
        const variable = (this.check('KEYWORD') ? this.advance() : this.consume('IDENTIFIER', "Expected variable name")).value;
        this.consume('OPERATOR', '=', "Expected '=' in assignment");

        // `x = call ...`, `x = retry call ...`, and `x = delegate ...` bind the
        // statement's RESULT to `x`. The expression evaluator can't execute
        // calls/delegations, so reuse the statement parsers and attach the output
        // variable (equivalent to the `... as x` form the runtime already binds).
        if (this.matchKeyword('call')) {
            const node = this.parseCall();
            node.outputVariable = variable;
            return node;
        }
        if (this.matchKeyword('retry')) {
            const node = this.parseRetry();
            const target: any = (node as any).targetStatement;
            if (target && target.type === 'CallExpression') target.outputVariable = variable;
            return node;
        }
        if (this.matchKeyword('delegate')) {
            const node = this.parseDelegate();
            node.resultVariable = variable;
            return node;
        }

        const value = this.parseExpression();
        return { type: 'Assignment', variable, value };
    }

    private parseWhile(): AST.WhileNode {
        // while condition { ... }
        // or: while condition label "loop1" { ... }
        const condition = this.parseExpression();

        let label: string | undefined;
        if (this.matchKeyword('label')) {
            label = this.consume('STRING', "Expected loop label").value;
        }

        const body = this.parseBlockBody();
        return { type: 'While', condition, body, label };
    }

    private parseBreak(): AST.BreakNode {
        // break or break "loop1"
        let label: string | undefined;
        if (this.check('STRING')) {
            label = this.advance().value;
        }
        return { type: 'Break', label };
    }

    private parseMatch(): AST.MatchNode {
        // match expression { case "a" { ... } case "b" { ... } default { ... } }
        const expression = this.parseExpression();

        const cases: AST.MatchCase[] = [];
        let defaultCase: AST.BlockNode | undefined;

        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                if (this.matchKeyword('case')) {
                    const pattern = this.parseExpression();
                    const body = this.parseBlockBody();
                    cases.push({ pattern, body });
                } else if (this.matchKeyword('default')) {
                    defaultCase = this.parseBlockBody();
                } else {
                    this.advance();
                }
            }
            this.consume('PUNCTUATION', '}', "Expected '}' to close match");
        }

        return { type: 'Match', expression, cases, defaultCase };
    }

    private parseValidate(): AST.ValidateNode {
        // validate input with schema UserSchema errors validationErrors
        const expression = this.parseExpression();

        this.consumeKeyword('with', "Expected 'with' after expression");

        let schema: string | object;
        if (this.check('STRING')) {
            schema = this.advance().value;
        } else if (this.check('PUNCTUATION', '{')) {
            // Inline schema object
            schema = this.parseExpression();
        } else {
            schema = this.consume('IDENTIFIER', "Expected schema name").value;
        }

        let errors: string | undefined;
        if (this.matchKeyword('errors')) {
            errors = this.consume('IDENTIFIER', "Expected error variable name").value;
        }

        return { type: 'Validate', expression, schema, errors };
    }

    private parseLog(): AST.LogNode {
        // log info "message" or log error "message" with { user: userId }
        let level: 'debug' | 'info' | 'warn' | 'error' = 'info';

        if (this.matchKeyword('debug')) level = 'debug';
        else if (this.matchKeyword('info')) level = 'info';
        else if (this.matchKeyword('warn')) level = 'warn';
        else if (this.matchKeyword('error')) level = 'error';

        const message = this.parseExpression();

        let metadata: Record<string, AST.ExpressionNode> | undefined;
        if (this.matchKeyword('with')) {
            metadata = this.parseArguments();
        }

        return { type: 'Log', level, message, metadata };
    }

    private parseMetric(): AST.MetricNode {
        // metric increment "api_calls" or metric gauge "queue_depth" value queue.length
        let action: 'increment' | 'decrement' | 'gauge' | 'histogram' | 'timing' = 'increment';

        if (this.matchKeyword('increment')) action = 'increment';
        else if (this.matchKeyword('decrement')) action = 'decrement';
        else if (this.matchKeyword('gauge')) action = 'gauge';
        else if (this.matchKeyword('histogram')) action = 'histogram';
        else if (this.matchKeyword('timing')) action = 'timing';

        const name = this.consume('STRING', "Expected metric name").value;

        let value: AST.ExpressionNode | undefined;
        if (this.matchKeyword('value')) {
            value = this.parseExpression();
        }

        let tags: Record<string, AST.ExpressionNode> | undefined;
        if (this.matchKeyword('tags')) {
            tags = this.parseArguments();
        }

        return { type: 'Metric', action, name, value, tags };
    }

    private parseAssert(): AST.AssertNode {
        // assert condition "error message"
        const condition = this.parseExpression();

        let message: string | undefined;
        if (this.check('STRING')) {
            message = this.advance().value;
        }

        return { type: 'Assert', condition, message };
    }

    private parseMask(): AST.MaskNode {
        // mask input.pattern "***-**-{last4}" as maskedValue
        const expression = this.parseExpression();

        this.consumeKeyword('pattern', "Expected 'pattern' after expression");
        const pattern = this.consume('STRING', "Expected mask pattern").value;

        this.consumeKeyword('as', "Expected 'as' after pattern");
        const outputVariable = this.consume('IDENTIFIER', "Expected variable name").value;

        return { type: 'Mask', expression, pattern, outputVariable };
    }

    private parseRateLimit(): AST.RateLimitNode {
        // rateLimit per user 100 per minute block
        let scope: 'global' | 'user' | 'tenant' | string = 'global';

        if (this.matchKeyword('per')) {
            if (this.matchKeyword('user')) scope = 'user';
            else if (this.matchKeyword('tenant')) scope = 'tenant';
            else {
                scope = this.consume('IDENTIFIER', "Expected scope identifier").value;
            }
        } else if (this.matchKeyword('global')) {
            scope = 'global';
        }

        const maxRequests = parseInt(this.consume('NUMBER', "Expected max requests").value, 10);

        this.consumeKeyword('per', "Expected 'per' after max requests");
        const window = this.consume('IDENTIFIER', "Expected time window").value;

        let action: 'block' | 'queue' | 'throttle' = 'block';
        if (this.matchKeyword('block')) action = 'block';
        else if (this.matchKeyword('queue')) action = 'queue';
        else if (this.matchKeyword('throttle')) action = 'throttle';

        return { type: 'RateLimit', scope, maxRequests, window, action };
    }

    private parseTransform(): AST.TransformNode {
        // transform data with { map: { name: "userName" }, filter: { active: true } } as result
        const expression = this.parseExpression();

        this.consumeKeyword('with', "Expected 'with' after expression");

        // Parse operations array or single operation
        const operations: AST.TransformOperation[] = [];

        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                    const opType = this.advance().value as AST.TransformOperation['type'];
                    this.consume('PUNCTUATION', ':', "Expected ':' after operation type");
                    const config = this.parseExpression();
                    operations.push({ type: opType, config: config as any });
                    this.match('PUNCTUATION', ',');
                } else {
                    this.advance();
                }
            }
            this.consume('PUNCTUATION', '}', "Expected '}' after operations");
        }

        this.consumeKeyword('as', "Expected 'as' after operations");
        const outputVariable = this.consume('IDENTIFIER', "Expected variable name").value;

        return { type: 'Transform', expression, operations, outputVariable };
    }

    private parseRemember(): AST.RememberStatementNode {
        // remember "key" as valueExpression
        // or: remember key as value
        let key: string;
        if (this.check('STRING')) {
            key = this.advance().value;
        } else {
            key = this.consume('IDENTIFIER', "Expected key name").value;
        }

        this.consumeKeyword('as', "Expected 'as' after key");
        const value = this.parseExpression();

        // Optional scope parameter
        let scope: string | undefined;
        if (this.matchKeyword('scope')) {
            scope = this.consume('STRING', "Expected scope value").value;
        }

        return { type: 'RememberStatement', key, value, scope };
    }

    private parseRecall(): AST.RecallStatementNode {
        // recall "key" or recall "key" as variable or recall "key" default "fallback"
        let key: string;
        if (this.check('STRING')) {
            key = this.advance().value;
        } else {
            key = this.consume('IDENTIFIER', "Expected key name").value;
        }

        let outputVariable: string | undefined;
        let defaultValue: AST.ExpressionNode | undefined;

        if (this.matchKeyword('as')) {
            outputVariable = this.consume('IDENTIFIER', "Expected variable name").value;
        }

        if (this.matchKeyword('default')) {
            defaultValue = this.parseExpression();
        }

        return { type: 'RecallStatement', key, outputVariable, defaultValue };
    }

    private parseForget(): AST.ForgetNode {
        // forget "key"
        let key: string;
        if (this.check('STRING')) {
            key = this.advance().value;
        } else {
            key = this.consume('IDENTIFIER', "Expected key name").value;
        }

        return { type: 'ForgetStatement', key };
    }

    private parseParallel(): AST.ParallelBlockNode {
        // parallel { call tool1, call tool2 } or parallel with timeout 5000 { ... }
        let timeout: number | undefined;

        if (this.matchKeyword('with')) {
            if (this.matchKeyword('timeout')) {
                this.match('PUNCTUATION', ':');
                timeout = parseInt(this.consume('NUMBER', "Expected timeout in ms").value, 10);
            }
        }

        const statements: AST.StatementNode[] = [];
        if (this.match('PUNCTUATION', '{')) {
            while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
                const stmt = this.parseStatement();
                if (stmt) statements.push(stmt);
                this.match('PUNCTUATION', ','); // Optional comma between parallel statements
            }
            this.consume('PUNCTUATION', '}', "Expected '}' to close parallel block");
        }

        return { type: 'ParallelBlock', statements, timeout };
    }

    private parseRetry(): AST.RetryConfigNode {
        // retry call api.request with backoff exponential max 5 fallback { ... }
        // retry { call api.request, call backup } with backoff linear max 3

        let maxAttempts = 3;
        let backoff: 'fixed' | 'exponential' | 'linear' = 'exponential';
        let baseDelay = 1000;
        let maxDelay: number | undefined;
        const retryOn: string[] = [];
        let fallback: AST.StatementNode | AST.BlockNode | null = null;

        // Parse the statement to wrap with retry
        const targetStatement = this.parseStatementToRetry();
        if (!targetStatement) {
            throw new Error("Expected statement after 'retry'");
        }

        // Parse retry options
        if (this.matchKeyword('with')) {
            while (!this.check('PUNCTUATION', '{') && !this.isAtEnd() &&
                   !(this.check('KEYWORD', 'fallback') || this.check('KEYWORD', 'on'))) {
                if (this.matchKeyword('backoff')) {
                    const backoffType = this.consume('IDENTIFIER', "Expected backoff type (fixed, exponential, linear)").value;
                    if (['fixed', 'exponential', 'linear'].includes(backoffType)) {
                        backoff = backoffType as typeof backoff;
                    }
                } else if (this.matchKeyword('max')) {
                    this.consume('KEYWORD', 'attempts', "Expected 'attempts' after 'max'");
                    maxAttempts = parseInt(this.consume('NUMBER', "Expected number").value, 10);
                } else if (this.matchKeyword('delay')) {
                    baseDelay = parseInt(this.consume('NUMBER', "Expected delay in ms").value, 10);
                } else if (this.matchKeyword('maxDelay')) {
                    maxDelay = parseInt(this.consume('NUMBER', "Expected max delay in ms").value, 10);
                }
                this.match('PUNCTUATION', ',');
            }
        }

        // Parse error types to retry on
        if (this.matchKeyword('on')) {
            this.consume('KEYWORD', 'error', "Expected 'error' after 'on'");
            if (this.check('PUNCTUATION', '[')) {
                this.advance();
                while (!this.check('PUNCTUATION', ']') && !this.isAtEnd()) {
                    if (this.check('STRING')) {
                        retryOn.push(this.advance().value);
                    } else if (this.check('IDENTIFIER')) {
                        retryOn.push(this.advance().value);
                    }
                    this.match('PUNCTUATION', ',');
                }
                this.consume('PUNCTUATION', ']', "Expected ']' after error types");
            }
        }

        // Parse fallback action
        if (this.matchKeyword('fallback')) {
            // Fallbacks are commonly written as `fallback { ... }`; accept the
            // block form as well as a single fallback statement.
            fallback = this.check('PUNCTUATION', '{')
                ? this.parseBlockBody()
                : this.parseStatement();
        }

        return {
            type: 'RetryConfig',
            targetStatement,
            maxAttempts,
            backoff,
            baseDelay,
            maxDelay,
            retryOn: retryOn.length > 0 ? retryOn : undefined,
            fallback: fallback || undefined
        };
    }

    private parseStatementToRetry(): AST.StatementNode | AST.BlockNode | null {
        // Parse only retryable statements (call, block, delegate, execute)
        // DO NOT call parseStatement() here to avoid infinite recursion with retry
        if (this.check('KEYWORD', 'call')) {
            this.advance();
            return this.parseCall();
        }
        if (this.check('KEYWORD', 'delegate')) {
            this.advance();
            return this.parseDelegate();
        }
        if (this.check('KEYWORD', 'execute')) {
            this.advance();
            return this.parsePlanExecution();
        }
        if (this.check('PUNCTUATION', '{')) {
            // Multiple statements - parse as a block
            return this.parseBlockBody();
        }
        // Not a retryable statement
        return null;
    }

    private parseSchedule(): AST.ScheduleNode {
        // schedule DailyReport at "0 9 * * 1-5" timezone "America/New_York" { ... }
        const name = this.consume('IDENTIFIER', "Expected schedule name").value;

        let cron: string;
        if (this.matchKeyword('at')) {
            cron = this.consume('STRING', "Expected cron expression").value;
        } else {
            throw new Error("Expected 'at' after schedule name with cron expression");
        }

        let timezone: string | undefined;
        if (this.matchKeyword('timezone')) {
            timezone = this.consume('STRING', "Expected timezone").value;
        }

        let enabled = true;
        if (this.matchKeyword('enabled')) {
            enabled = this.consume('KEYWORD', 'true', "Expected 'true' or 'false'") ? true :
                     (this.consume('KEYWORD', 'false') ? false : true);
        }

        const body = this.parseBlockBody();
        return { type: 'Schedule', name, cron, timezone, enabled, body };
    }

    private parseWebhook(): AST.WebhookNode {
        // webhook githubPush path "/github/push" method POST verify signature with secret GITHUB_SECRET { ... }
        const name = this.consume('IDENTIFIER', "Expected webhook name").value;

        let path: string;
        if (this.matchKeyword('path')) {
            path = this.consume('STRING', "Expected webhook path").value;
        } else {
            // Default path from name
            path = `/${name.toLowerCase()}`;
        }

        let method: 'POST' | 'GET' | 'PUT' | 'DELETE' = 'POST';
        if (this.matchKeyword('method')) {
            const methodStr = this.consume('IDENTIFIER', "Expected HTTP method").value.toUpperCase();
            if (['POST', 'GET', 'PUT', 'DELETE'].includes(methodStr)) {
                method = methodStr as typeof method;
            }
        }

        let secret: string | undefined;
        let verifySignature = false;

        if (this.matchKeyword('verify')) {
            this.consume('KEYWORD', 'signature', "Expected 'signature' after 'verify'");
            verifySignature = true;
            if (this.matchKeyword('with')) {
                this.consume('KEYWORD', 'secret', "Expected 'secret' after 'with'");
                if (this.check('STRING')) {
                    secret = this.advance().value;
                } else {
                    secret = this.consume('IDENTIFIER', "Expected secret name").value;
                }
            }
        }

        const body = this.parseBlockBody();
        return { type: 'Webhook', name, path, method, secret, verifySignature, body };
    }

    // ============ Expression Parsing ============

    private parseArguments(): Record<string, AST.ExpressionNode> {
        const args: Record<string, AST.ExpressionNode> = {};
        const hasBraces = this.match('PUNCTUATION', '{');

        if (hasBraces && this.check('PUNCTUATION', '}')) {
            this.advance();
            return args;
        }

        do {
            if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
                const key = this.advance().value;
                this.consume('PUNCTUATION', ':', "Expected ':' after argument name");
                const value = this.parseExpression();
                args[key] = value;
            } else {
                break;
            }
        } while (this.match('PUNCTUATION', ','));

        if (hasBraces) {
            this.consume('PUNCTUATION', '}', "Expected '}' at end of arguments");
        }

        return args;
    }

    private parseExpression(): AST.ExpressionNode {
        return this.parseTernary();
    }

    // Ternary: `test ? consequent : alternate`. Sits above `??`/`or` so the whole
    // logical expression is the test. Right-associative (nested ternaries chain).
    private parseTernary(): AST.ExpressionNode {
        const test = this.parseNullish();
        if (this.match('OPERATOR', '?')) {
            const consequent = this.parseTernary();
            this.consume('PUNCTUATION', ':', "Expected ':' in ternary expression");
            const alternate = this.parseTernary();
            return { type: 'ConditionalExpression', test, consequent, alternate };
        }
        return test;
    }

    // Nullish coalescing: `a ?? b` → b when a is null/undefined. Left-associative.
    // The AI generator commonly writes `input.x ?? "default"` inside argument
    // values; without this the `??` token was unexpected and broke the whole call
    // ("Expected '}' at end of arguments"). Runtime maps operator '??' accordingly.
    private parseNullish(): AST.ExpressionNode {
        let left = this.parseOr();
        while (this.match('OPERATOR', '??')) {
            const right = this.parseOr();
            left = { type: 'BinaryExpression', operator: '??', left, right };
        }
        return left;
    }

    private parseOr(): AST.ExpressionNode {
        let left = this.parseAnd();
        while (this.matchKeyword('or') || this.match('OPERATOR', '||')) {
            const right = this.parseAnd();
            left = { type: 'BinaryExpression', operator: 'or', left, right };
        }
        return left;
    }

    private parseAnd(): AST.ExpressionNode {
        let left = this.parseEquality();
        while (this.matchKeyword('and') || this.match('OPERATOR', '&&')) {
            const right = this.parseEquality();
            left = { type: 'BinaryExpression', operator: 'and', left, right };
        }
        return left;
    }

    private parseEquality(): AST.ExpressionNode {
        let left = this.parseComparison();
        while (this.match('OPERATOR', '==') || this.match('OPERATOR', '!=')) {
            const operator = this.previous().value;
            const right = this.parseComparison();
            left = { type: 'BinaryExpression', operator, left, right };
        }
        return left;
    }

    private parseComparison(): AST.ExpressionNode {
        let left = this.parseTerm();
        while (this.match('OPERATOR', '>') || this.match('OPERATOR', '<') ||
            this.match('OPERATOR', '>=') || this.match('OPERATOR', '<=') ||
            this.matchKeyword('contains')) {
            const operator = this.previous().value;
            const right = this.parseTerm();
            left = { type: 'BinaryExpression', operator, left, right };
        }
        return left;
    }

    private parseTerm(): AST.ExpressionNode {
        let left = this.parseFactor();
        while (this.match('OPERATOR', '+') || this.match('OPERATOR', '-')) {
            const operator = this.previous().value;
            const right = this.parseFactor();
            left = { type: 'BinaryExpression', operator, left, right };
        }
        return left;
    }

    private parseFactor(): AST.ExpressionNode {
        let left = this.parsePrimary();
        while (this.match('OPERATOR', '*') || this.match('OPERATOR', '/')) {
            const operator = this.previous().value;
            const right = this.parsePrimary();
            left = { type: 'BinaryExpression', operator, left, right };
        }

        // Member access
        while (true) {
            if (this.match('PUNCTUATION', '.')) {
                // After a `.`, the property name is unambiguously an identifier even
                // when the word is a reserved keyword — `input.to`, `msg.from`,
                // `job.with` are all valid property accesses. Without accepting
                // KEYWORD here, any object property that collides with a HiveLang
                // keyword (to/from/with/as/…) throws "Expected property name" and
                // silently breaks real bots (e.g. gmail sendEmail's `input.to`).
                const propTok = this.check('KEYWORD') ? this.advance() : this.consume('IDENTIFIER', "Expected property name");
                const property: AST.IdentifierNode = {
                    type: 'Identifier',
                    name: propTok.value
                };
                left = { type: 'MemberExpression', object: left, property, computed: false };
            } else if (this.match('PUNCTUATION', '[')) {
                const property = this.parseExpression();
                this.consume('PUNCTUATION', ']', "Expected ']'");
                left = { type: 'MemberExpression', object: left, property, computed: true };
            } else {
                break;
            }
        }

        return left;
    }

    private parsePrimary(): AST.ExpressionNode {
        // Parentheses
        if (this.match('PUNCTUATION', '(')) {
            const expr = this.parseExpression();
            this.consume('PUNCTUATION', ')', "Expected ')'");
            return expr;
        }

        // Arrays
        if (this.match('PUNCTUATION', '[')) {
            const elements: AST.ExpressionNode[] = [];
            if (!this.check('PUNCTUATION', ']')) {
                do {
                    elements.push(this.parseExpression());
                } while (this.match('PUNCTUATION', ','));
            }
            this.consume('PUNCTUATION', ']', "Expected ']'");
            return { type: 'ArrayLiteral', elements };
        }

        // Objects
        if (this.match('PUNCTUATION', '{')) {
            const properties: Record<string, AST.ExpressionNode> = {};
            if (!this.check('PUNCTUATION', '}')) {
                do {
                    let key: string;
                    if (this.check('STRING')) {
                        key = this.advance().value;
                    } else {
                        key = this.consume('IDENTIFIER', "Expected object key").value;
                    }
                    this.consume('PUNCTUATION', ':', "Expected ':'");
                    properties[key] = this.parseExpression();
                } while (this.match('PUNCTUATION', ','));
            }
            this.consume('PUNCTUATION', '}', "Expected '}'");
            return { type: 'ObjectLiteral', properties };
        }

        // Literals
        if (this.match('STRING')) {
            return { type: 'Literal', value: this.previous().value, raw: this.previous().value };
        }
        if (this.match('FSTRING')) {
            return { type: 'FString', template: this.previous().value };
        }
        if (this.match('NUMBER')) {
            return { type: 'Literal', value: parseFloat(this.previous().value), raw: this.previous().value };
        }
        if (this.matchKeyword('true')) {
            return { type: 'Literal', value: true, raw: 'true' };
        }
        if (this.matchKeyword('false')) {
            return { type: 'Literal', value: false, raw: 'false' };
        }
        if (this.matchKeyword('null')) {
            return { type: 'Literal', value: null, raw: 'null' };
        }
        if (this.matchKeyword('input')) {
            return { type: 'Identifier', name: 'input' };
        }

        // Identifiers
        if (this.match('IDENTIFIER')) {
            return { type: 'Identifier', name: this.previous().value };
        }

        // A reserved word used where a VALUE is expected is a variable reference —
        // e.g. `say response` after `... as response`. Structural keywords (`if`,
        // `call`, `for`, `say`, …) are consumed by parseStatement before we ever get
        // here, so a KEYWORD reaching parsePrimary is being used as an identifier.
        // (Mirrors the existing special-case for `input` above, generalized — the AI
        // generator binds and reads reserved words like `response` as ordinary vars.)
        if (this.check('KEYWORD')) {
            return { type: 'Identifier', name: this.advance().value };
        }

        throw new Error(`Unexpected token: ${this.peek().value} at line ${this.peek().line}`);
    }

    // ============ Helpers ============

    private match(type: TokenType, value?: string): boolean {
        if (this.check(type, value)) {
            this.advance();
            return true;
        }
        return false;
    }

    private matchKeyword(keyword: string): boolean {
        return this.match('KEYWORD', keyword);
    }

    private check(type: TokenType, value?: string): boolean {
        if (this.isAtEnd()) return false;
        const t = this.peek();
        if (t.type !== type) return false;
        if (value && t.value !== value) return false;
        return true;
    }

    private checkNext(type: TokenType, value?: string): boolean {
        if (this.current + 1 >= this.tokens.length) return false;
        const t = this.tokens[this.current + 1];
        if (t.type !== type) return false;
        if (value && t.value !== value) return false;
        return true;
    }

    private consume(type: TokenType, valueOrMessage: string, message?: string): Token {
        if (message === undefined) {
            // consume(type, message)
            if (this.check(type)) return this.advance();
            throw new Error(valueOrMessage);
        }
        // consume(type, value, message)
        if (this.check(type, valueOrMessage)) return this.advance();
        throw new Error(message);
    }

    private consumeKeyword(keyword: string, message?: string): Token {
        if (this.matchKeyword(keyword)) return this.previous();
        throw new Error(message || `Expected keyword '${keyword}'`);
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.current++;
        return this.previous();
    }

    private previous(): Token {
        return this.tokens[this.current - 1];
    }

    private peek(): Token {
        return this.tokens[this.current];
    }

    private isAtEnd(): boolean {
        return this.peek().type === 'EOF';
    }

    private synchronize() {
        this.advance();
        while (!this.isAtEnd()) {
            if (this.peek().type === 'KEYWORD') {
                const kw = this.peek().value;
                if (['bot', 'agent', 'swarm', 'on', 'plan', 'schedule', 'webhook'].includes(kw)) return;
            }
            this.advance();
        }
    }

    private formatError(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        const token = this.peek();
        return /\bat \d+:\d+\b/.test(message) ? message : `${message} at ${token.line}:${token.column}`;
    }

    private reportUnexpected(context: string): void {
        const token = this.peek();
        this.errors.push(`Unexpected ${token.type.toLowerCase()} "${token.value}" in ${context} at ${token.line}:${token.column}`);
    }
}

// ============ Convenience Function ============

export function parseHiveLang(code: string): ParseResult {
    const tokenizer = new Tokenizer(code);
    const tokens = tokenizer.tokenize();
    const parser = new Parser(tokens, code);
    const result = parser.parse();
    result.errors.unshift(...tokenizer.getErrors());
    return result;
}
