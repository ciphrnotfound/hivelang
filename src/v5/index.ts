/**
 * HiveLang v5 - AI-First Bot Definition Language
 *
 * The fundamental paradigm shift:
 * - AI is the brain, not a tool
 * - HiveLang defines what AI knows and can do
 * - No explicit general.respond needed
 */

export * from './ast';
export * from './tokenizer';
export * from './parser';
export * from './runtime';
export * from './validation';

// Re-export main classes for convenience
export { Tokenizer } from './tokenizer';
export { Parser, parseHiveLang } from './parser';
export { HiveLangV5Runtime } from './runtime';

import { AICallFunction, HiveLangV5Runtime } from './runtime';

/**
 * Create a new HiveLang v5 runtime with default configuration
 */
export function createRuntime(aiCallFn: AICallFunction): HiveLangV5Runtime {
    return new HiveLangV5Runtime(aiCallFn);
}

export * from './tool-schemas';
