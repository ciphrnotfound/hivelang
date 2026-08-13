/**
 * HiveLang v5 AST - AI-First Architecture
 *
 * In v5, the bot IS the AI. HiveLang defines:
 * - What the AI knows (instructions/system prompt)
 * - What the AI can do (capabilities/tools)
 * - Optional hooks (before/after processing)
 */

// ============ Core Bot Definition ============

export interface BotDefinitionNode {
    type: 'BotDefinition';
    name: string;
    description?: string;
    instructions?: string;      // AI's system prompt
    capabilities: string[];     // Tools the AI can use
    beforeHook?: BlockNode;     // Optional pre-processing
    afterHook?: BlockNode;      // Optional post-processing
    agents?: AgentDefinitionNode[];  // Sub-agents for specialized tasks
    events?: EventHandlerNode[];     // Event-driven triggers
    reactHandlers?: ReActHandlerNode[];      // ReAct reasoning blocks
    totHandlers?: TreeOfThoughtsHandlerNode[];  // ToT multi-path reasoning
    plans?: PlanNode[];          // Named reusable execution plans
    schedules?: ScheduleNode[];  // Cron schedules
    webhooks?: WebhookNode[];    // Webhook endpoints
    grounding?: GroundingNode;
    memoryPolicy?: MemoryPolicyNode;
}

/** V5.1: declarative evidence requirements for knowledge-grounded agents. */
export interface GroundingNode {
    knowledge: 'required' | 'optional' | 'off';
    citeSources: boolean;
    onMissing?: 'say_uncertain' | 'ask_clarifying_question';
}

/** V5.1: runtime constraints for durable memory extraction. */
export interface MemoryPolicyNode {
    mode: 'none' | 'session' | 'durable';
    ttl?: string;
    rememberOnly: string[];
    neverRemember: string[];
}

export interface AgentDefinitionNode {
    type: 'AgentDefinition';
    name: string;
    role?: string;              // Agent's specialized role
    capabilities: string[];     // Agent-specific tools
    body?: BlockNode;
}

export interface EventHandlerNode {
    type: 'EventHandler';
    event: string;              // e.g., "github.push", "schedule.daily"
    body: BlockNode;
}

// ReAct (Reasoning + Acting) handler for multi-step reasoning
export interface ReActHandlerNode {
    type: 'ReActHandler';
    trigger: string;           // Pattern to match (e.g., "troubleshoot *")
    maxSteps: number;          // Max reasoning steps
    body?: BlockNode;          // Optional custom steps
}

// Tree of Thoughts handler for exploring multiple solution paths
export interface TreeOfThoughtsHandlerNode {
    type: 'TreeOfThoughtsHandler';
    trigger: string;           // Pattern to match
    maxDepth: number;         // How deep to explore
    branchFactor: number;     // How many candidates per step
    body?: BlockNode;
}

// ============ Program Structure ============

export interface ProgramNode {
    type: 'Program';
    bots: BotDefinitionNode[];
    imports: ImportNode[];
}

export interface ImportNode {
    type: 'Import';
    module: string;
}

// ============ Statements ============

export interface BlockNode {
    type: 'Block';
    statements: StatementNode[];
}

export type StatementNode =
    | CallExpressionNode
    | SayStatementNode
    | AssignmentNode
    | IfStatementNode
    | LoopStatementNode
    | ReturnStatementNode
    | DelegateStatementNode
    | RespondStatementNode
    | RememberStatementNode      // Store in persistent memory
    | RecallStatementNode        // Retrieve from memory
    | ParallelBlockNode            // Execute in parallel
    | PlanExecutionNode            // Execute a named plan
    | CheckpointNode               // Save/restore state checkpoint
    | RetryConfigNode              // Configure retry behavior
    | MatchNode                    // Pattern matching
    | WhileNode                    // While loop
    | BreakNode                    // Break statement
    | ValidateNode                 // Input validation
    | LogNode                      // Logging
    | MetricNode                   // Metrics
    | ForgetNode                   // Remove from memory
    | AssertNode                   // Assertions
    | MaskNode                     // Data masking
    | RateLimitNode                // Rate limiting
    | TransformNode;               // Data transformation

export interface CallExpressionNode {
    type: 'CallExpression';
    tool: string;
    arguments: Record<string, ExpressionNode>;
    outputVariable?: string;
}

export interface SayStatementNode {
    type: 'SayStatement';
    message: ExpressionNode;
}

export interface AssignmentNode {
    type: 'Assignment';
    variable: string;
    value: ExpressionNode;
}

export interface IfStatementNode {
    type: 'IfStatement';
    condition: ExpressionNode;
    consequent: BlockNode;
    alternate?: BlockNode | IfStatementNode;
}

export interface LoopStatementNode {
    type: 'LoopStatement';
    variable: string;
    iterable: ExpressionNode;
    body: BlockNode;
}

export interface ReturnStatementNode {
    type: 'ReturnStatement';
    value?: ExpressionNode;
}

export interface DelegateStatementNode {
    type: 'DelegateStatement';
    targetAgent: string;
    params: Record<string, ExpressionNode>;
    /** Set by `x = delegate to Agent ...` — binds the delegation result to `x`. */
    resultVariable?: string;
}

// NEW: Explicit respond statement (rarely needed in v5 since AI responds by default)
export interface RespondStatementNode {
    type: 'RespondStatement';
    message: ExpressionNode;
}

// Memory operations for persistent storage
export interface RememberStatementNode {
    type: 'RememberStatement';
    key: string;              // Memory key
    value: ExpressionNode;    // Value to store
    scope?: string;           // Optional: 'session', 'user', 'global'
}

export interface RecallStatementNode {
    type: 'RecallStatement';
    key: string;              // Memory key to retrieve
    outputVariable?: string;    // Variable to store result
    defaultValue?: ExpressionNode;  // Default if not found
}

export interface ForgetNode {
    type: 'ForgetStatement';
    key: string;              // Memory key to forget
}

// Parallel execution block
export interface ParallelBlockNode {
    type: 'ParallelBlock';
    statements: StatementNode[];  // Statements to execute in parallel
    timeout?: number;              // Optional timeout in ms
}

// Plan definition - reusable multi-step workflow
export interface PlanNode {
    type: 'Plan';
    name: string;                  // Plan identifier
    description?: string;          // What this plan does
    inputs: string[];              // Required input variables
    checkpoints?: string[];        // Named checkpoints within the plan
    body: BlockNode;               // Plan steps
}

// Execute a named plan with parameters
export interface PlanExecutionNode {
    type: 'PlanExecution';
    planName: string;             // Name of plan to execute
    params: Record<string, ExpressionNode>;  // Input parameters
    resumeFrom?: string;          // Optional checkpoint to resume from
}

// Retry configuration for resilient execution
export interface RetryConfigNode {
    type: 'RetryConfig';
    targetStatement: StatementNode | BlockNode;  // The statement to wrap with retry
    maxAttempts: number;             // Max retry attempts (default 3)
    backoff: 'fixed' | 'exponential' | 'linear';  // Backoff strategy
    baseDelay: number;               // Base delay in ms (default 1000)
    maxDelay?: number;               // Max delay cap in ms
    retryOn?: string[];              // Error types to retry on
    fallback?: StatementNode | BlockNode;        // Fallback action if all retries fail
}

// Checkpoint for saving/restoring state
export interface CheckpointNode {
    type: 'Checkpoint';
    name: string;                 // Checkpoint identifier
    scope?: 'local' | 'global' | 'persistent';  // Persistence scope
    action: 'save' | 'restore' | 'clear';         // Checkpoint action
}

// Schedule for cron-like automation
export interface ScheduleNode {
    type: 'Schedule';
    name: string;                    // Schedule identifier
    cron: string;                    // Cron expression
    timezone?: string;               // Optional timezone (default UTC)
    enabled: boolean;                // Whether schedule is active
    body: BlockNode;                 // Statements to execute
}

// Webhook endpoint definition
export interface WebhookNode {
    type: 'Webhook';
    name: string;                    // Webhook identifier
    path: string;                    // URL path (e.g., "/github/push")
    method: 'POST' | 'GET' | 'PUT' | 'DELETE';  // HTTP method
    secret?: string;                 // Optional secret for signature verification
    verifySignature?: boolean;       // Whether to verify webhook signature
    body: BlockNode;                 // Handler statements
}

// Pattern matching (like switch/match in other languages)
export interface MatchNode {
    type: 'Match';
    expression: ExpressionNode;      // Value to match against
    cases: MatchCase[];              // Match cases
    defaultCase?: BlockNode;          // Default case if no match
}

export interface MatchCase {
    pattern: ExpressionNode;           // Pattern to match (literal, range, etc)
    body: BlockNode;                   // Statements to execute if matched
}

// While loop for unknown iteration counts
export interface WhileNode {
    type: 'While';
    condition: ExpressionNode;       // Continue while true
    body: BlockNode;                 // Loop body
    label?: string;                  // Optional label for break/continue
}

// Break statement for exiting loops
export interface BreakNode {
    type: 'Break';
    label?: string;                  // Optional: break specific labeled loop
}

// Input validation with schema
export interface ValidateNode {
    type: 'Validate';
    expression: ExpressionNode;      // Value to validate
    schema: string | object;           // Schema name or inline schema
    errors?: string;                   // Variable to store validation errors
}

// Logging statement
export interface LogNode {
    type: 'Log';
    level: 'debug' | 'info' | 'warn' | 'error';
    message: ExpressionNode;
    metadata?: Record<string, ExpressionNode>;
}

// Metrics for observability
export interface MetricNode {
    type: 'Metric';
    action: 'increment' | 'decrement' | 'gauge' | 'histogram' | 'timing';
    name: string;
    value?: ExpressionNode;          // Optional value (defaults to 1 for increment)
    tags?: Record<string, ExpressionNode>;  // Metric tags/dimensions
}

// Assertions for debugging
export interface AssertNode {
    type: 'Assert';
    condition: ExpressionNode;
    message?: string;                // Error message if assertion fails
}

// Data masking for security
export interface MaskNode {
    type: 'Mask';
    expression: ExpressionNode;      // Value to mask
    pattern: string;                 // Mask pattern (e.g., "***-**-{last4}")
    outputVariable: string;          // Where to store masked value
}

// Rate limiting
export interface RateLimitNode {
    type: 'RateLimit';
    scope: 'global' | 'user' | 'tenant' | string;  // Rate limit scope
    maxRequests: number;
    window: string;                    // Time window (e.g., "1m", "1h")
    action: 'block' | 'queue' | 'throttle';  // What to do when limit hit
}

// Data transformation
export interface TransformNode {
    type: 'Transform';
    expression: ExpressionNode;      // Input data
    operations: TransformOperation[];
    outputVariable: string;
}

export interface TransformOperation {
    type: 'map' | 'filter' | 'pick' | 'omit' | 'rename' | 'compute';
    config: Record<string, any>;
}

// ============ Expressions ============

export type ExpressionNode =
    | LiteralNode
    | IdentifierNode
    | BinaryExpressionNode
    | MemberExpressionNode
    | ConditionalExpressionNode
    | FStringNode
    | ArrayLiteralNode
    | ObjectLiteralNode;

export interface ConditionalExpressionNode {
    type: 'ConditionalExpression';
    test: ExpressionNode;
    consequent: ExpressionNode;
    alternate: ExpressionNode;
}

export interface LiteralNode {
    type: 'Literal';
    value: string | number | boolean | null;
    raw: string;
}

export interface IdentifierNode {
    type: 'Identifier';
    name: string;
}

export interface BinaryExpressionNode {
    type: 'BinaryExpression';
    operator: string;
    left: ExpressionNode;
    right: ExpressionNode;
}

export interface MemberExpressionNode {
    type: 'MemberExpression';
    object: ExpressionNode;
    property: ExpressionNode;
    computed: boolean;
}

export interface FStringNode {
    type: 'FString';
    template: string;
}

export interface ArrayLiteralNode {
    type: 'ArrayLiteral';
    elements: ExpressionNode[];
}

export interface ObjectLiteralNode {
    type: 'ObjectLiteral';
    properties: Record<string, ExpressionNode>;
}
