import * as AST from './ast';

export type HiveLangDiagnosticSeverity = 'error' | 'warning';

export interface HiveLangDiagnostic {
    severity: HiveLangDiagnosticSeverity;
    message: string;
    bot?: string;
}

const BUILTIN_CALLS = new Set(['delegate']);

/**
 * Link cross-references after parsing. The parser deliberately accepts AI-generated
 * syntax liberally; this pass is where declarations are made internally consistent.
 */
export function validateProgram(program: AST.ProgramNode): HiveLangDiagnostic[] {
    const diagnostics: HiveLangDiagnostic[] = [];
    const seenBots = new Set<string>();

    for (const bot of program.bots) {
        if (seenBots.has(bot.name)) {
            diagnostics.push({ severity: 'error', bot: bot.name, message: `Duplicate bot declaration: "${bot.name}".` });
        }
        seenBots.add(bot.name);

        const capabilities = new Set<string>();
        for (const capability of bot.capabilities) {
            if (capabilities.has(capability)) {
                diagnostics.push({ severity: 'warning', bot: bot.name, message: `Duplicate capability "${capability}".` });
            }
            capabilities.add(capability);
        }

        const agentNames = new Set<string>();
        for (const agent of bot.agents ?? []) {
            if (agentNames.has(agent.name)) {
                diagnostics.push({ severity: 'error', bot: bot.name, message: `Duplicate agent declaration: "${agent.name}".` });
            }
            agentNames.add(agent.name);
        }

        const plans = new Set((bot.plans ?? []).map(plan => plan.name));
        const validateBlock = (block: AST.BlockNode | undefined, scopeCapabilities: Set<string>) => {
            if (!block) return;
            for (const statement of block.statements) {
                if (statement.type === 'DelegateStatement' && !agentNames.has(statement.targetAgent)) {
                    diagnostics.push({ severity: 'error', bot: bot.name, message: `Unknown delegate target "${statement.targetAgent}" in bot "${bot.name}".` });
                }
                if (statement.type === 'PlanExecution' && !plans.has(statement.planName)) {
                    diagnostics.push({ severity: 'error', bot: bot.name, message: `Unknown plan "${statement.planName}" in bot "${bot.name}".` });
                }
                if (statement.type === 'CallExpression' && !scopeCapabilities.has(statement.tool) && !BUILTIN_CALLS.has(statement.tool)) {
                    diagnostics.push({ severity: 'warning', bot: bot.name, message: `Tool "${statement.tool}" is not declared in capabilities; host registration is still required at runtime.` });
                }
                if (statement.type === 'IfStatement') {
                    validateBlock(statement.consequent, scopeCapabilities);
                    if (statement.alternate?.type === 'Block') validateBlock(statement.alternate, scopeCapabilities);
                } else if (statement.type === 'LoopStatement' || statement.type === 'While' || statement.type === 'ParallelBlock') {
                    validateBlock(statement.type === 'ParallelBlock' ? { type: 'Block', statements: statement.statements } : statement.body, scopeCapabilities);
                } else if (statement.type === 'Match') {
                    statement.cases.forEach(matchCase => validateBlock(matchCase.body, scopeCapabilities));
                    validateBlock(statement.defaultCase, scopeCapabilities);
                } else if (statement.type === 'RetryConfig') {
                    const target = statement.targetStatement;
                    if (target.type === 'Block') validateBlock(target, scopeCapabilities);
                    else validateBlock({ type: 'Block', statements: [target] }, scopeCapabilities);
                    if (statement.fallback) {
                        if (statement.fallback.type === 'Block') validateBlock(statement.fallback, scopeCapabilities);
                        else validateBlock({ type: 'Block', statements: [statement.fallback] }, scopeCapabilities);
                    }
                }
            }
        };

        validateBlock(bot.beforeHook, capabilities);
        validateBlock(bot.afterHook, capabilities);
        bot.events?.forEach(event => validateBlock(event.body, capabilities));
        bot.plans?.forEach(plan => validateBlock(plan.body, capabilities));
        bot.schedules?.forEach(schedule => validateBlock(schedule.body, capabilities));
        bot.webhooks?.forEach(webhook => validateBlock(webhook.body, capabilities));
        bot.agents?.forEach(agent => validateBlock(agent.body, new Set([...capabilities, ...agent.capabilities])));
    }

    return diagnostics;
}
