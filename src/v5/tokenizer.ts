/**
 * HiveLang v5 Tokenizer - Curly Brace Syntax
 *
 * Handles: bot Name { ... }, instructions { ... }, capabilities { ... }
 */

export type TokenType =
    | 'KEYWORD'
    | 'IDENTIFIER'
    | 'STRING'
    | 'FSTRING'
    | 'NUMBER'
    | 'OPERATOR'
    | 'PUNCTUATION'
    | 'COMMENT'
    | 'MULTILINE_TEXT'  // For instructions { ... } block content
    | 'NEWLINE'
    | 'EOF';

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
    /** Zero-based source range. Retained through parsing for accurate diagnostics. */
    start: number;
    end: number;
}

const KEYWORDS = new Set([
    'bot', 'agent', 'swarm',
    'instructions', 'capabilities', 'description', 'role',
    'before', 'after', 'on', 'input', 'response', 'event',
    'if', 'else', 'elif',
    'loop', 'for', 'in',
    'call', 'with', 'as',
    'say', 'respond',
    'delegate', 'to',
    'return',
    'import',
    'true', 'false', 'null',
    'and', 'or', 'not', 'contains',
    // New keywords for enterprise features
    'retry', 'backoff', 'max', 'attempts', 'delay', 'maxDelay', 'fallback', 'on', 'error',
    'schedule', 'at', 'timezone', 'enabled',
    'webhook', 'path', 'method', 'POST', 'GET', 'PUT', 'DELETE', 'verify', 'signature', 'secret',
    'plan', 'execute', 'resume', 'from',
    'checkpoint', 'save', 'restore', 'clear', 'scope',
    'react', 'treeOfThoughts', 'tot', 'maxSteps', 'depth', 'branch', 'branchFactor',
    'remember', 'recall', 'parallel', 'timeout',
    // 10 new keywords
    'match', 'case', 'default', 'while', 'break', 'validate', 'log', 'metric', 'assert', 'mask', 'transform'
    , 'grounding', 'required', 'optional', 'off', 'cite_sources', 'on_missing',
    'memory', 'mode', 'ttl', 'remember_only', 'never_remember', 'none', 'session', 'durable'
]);

export class Tokenizer {
    private source: string;
    private tokens: Token[] = [];
    private current = 0;
    private line = 1;
    private column = 1;
    private errors: string[] = [];

    constructor(source: string) {
        this.source = source;
    }

    tokenize(): Token[] {
        while (!this.isAtEnd()) {
            this.scanToken();
        }
        this.tokens.push({ type: 'EOF', value: '', line: this.line, column: this.column, start: this.current, end: this.current });
        return this.tokens;
    }

    getErrors(): string[] {
        return [...this.errors];
    }

    private scanToken() {
        this.skipWhitespace();
        if (this.isAtEnd()) return;

        const char = this.peek();

        // Plain-language blocks commonly contain contractions and possessives.
        // An apostrophe between word characters is punctuation, not the start
        // of a single-quoted HiveLang string (for example: "don't" or "user's").
        if (char === "'" && this.isAlphaNumeric(this.peekPrevious()) && this.isAlphaNumeric(this.peekNext())) {
            this.advance();
            return;
        }

        // Comments
        if (char === '#') {
            this.skipComment();
            return;
        }

        // Newlines (track but don't emit as separate tokens in v5)
        if (char === '\n') {
            this.advance();
            this.line++;
            this.column = 1;
            return;
        }

        // Strings
        if (char === '"' || char === "'") {
            this.scanString(char);
            return;
        }

        // F-strings
        if (char === 'f' && (this.peekNext() === '"' || this.peekNext() === "'")) {
            this.advance(); // consume 'f'
            this.scanFString(this.peek());
            return;
        }

        // Numbers
        if (this.isDigit(char)) {
            this.scanNumber();
            return;
        }

        // Identifiers and keywords
        if (this.isAlpha(char)) {
            this.scanIdentifier();
            return;
        }

        // Operators
        if ('+-*/%=<>!&|?'.includes(char)) {
            this.scanOperator();
            return;
        }

        // Punctuation
        if ('{}[]():,.'.includes(char)) {
            this.addToken('PUNCTUATION', this.advance());
            return;
        }

        // Unknown characters must never disappear silently: they often indicate a
        // malformed generated program or a copy/paste encoding issue.
        const startLine = this.line;
        const startCol = this.column;
        const unknown = this.advance();
        this.errors.push(`Unexpected character "${unknown}" at ${startLine}:${startCol}`);
    }

    private scanString(quote: string) {
        const startLine = this.line;
        const startCol = this.column;
        const start = this.current;
        this.advance(); // consume opening quote

        let value = '';
        while (!this.isAtEnd() && this.peek() !== quote) {
            if (this.peek() === '\\' && this.peekNext() === quote) {
                this.advance(); // skip backslash
                value += this.advance();
            } else if (this.peek() === '\n') {
                value += this.advance();
                this.line++;
                this.column = 1;
            } else {
                value += this.advance();
            }
        }

        if (!this.isAtEnd()) {
            this.advance(); // consume closing quote
        } else {
            this.errors.push(`Unterminated string at ${startLine}:${startCol}`);
        }

        this.tokens.push({ type: 'STRING', value, line: startLine, column: startCol, start, end: this.current });
    }

    private scanFString(quote: string) {
        const startLine = this.line;
        const startCol = this.column;
        const start = this.current - 1;
        this.advance(); // consume opening quote

        let value = '';
        while (!this.isAtEnd() && this.peek() !== quote) {
            if (this.peek() === '\\' && this.peekNext() === quote) {
                this.advance();
                value += this.advance();
            } else if (this.peek() === '\n') {
                value += this.advance();
                this.line++;
                this.column = 1;
            } else {
                value += this.advance();
            }
        }

        if (!this.isAtEnd()) {
            this.advance(); // consume closing quote
        } else {
            this.errors.push(`Unterminated f-string at ${startLine}:${startCol}`);
        }

        this.tokens.push({ type: 'FSTRING', value, line: startLine, column: startCol, start, end: this.current });
    }

    private scanNumber() {
        const startCol = this.column;
        const start = this.current;
        let value = '';

        while (this.isDigit(this.peek())) {
            value += this.advance();
        }

        if (this.peek() === '.' && this.isDigit(this.peekNext())) {
            value += this.advance(); // consume '.'
            while (this.isDigit(this.peek())) {
                value += this.advance();
            }
        }

        this.tokens.push({ type: 'NUMBER', value, line: this.line, column: startCol, start, end: this.current });
    }

    private scanIdentifier() {
        const startCol = this.column;
        const start = this.current;
        let value = '';

        // Integration slugs commonly contain a hyphen (`google-tasks`,
        // `microsoft-todo`). Keep it inside an identifier when it connects two
        // identifier characters; a standalone `-` remains bullet/operator syntax.
        while (this.isAlphaNumeric(this.peek()) || (this.peek() === '-' && this.isAlphaNumeric(this.peekNext()))) {
            value += this.advance();
        }

        const type: TokenType = KEYWORDS.has(value) ? 'KEYWORD' : 'IDENTIFIER';
        this.tokens.push({ type, value, line: this.line, column: startCol, start, end: this.current });
    }

    private scanOperator() {
        const startCol = this.column;
        const start = this.current;
        let value = this.advance();

        // Two-character operators
        const next = this.peek();
        if ((value === '=' && next === '=') ||
            (value === '!' && next === '=') ||
            (value === '<' && next === '=') ||
            (value === '>' && next === '=') ||
            (value === '&' && next === '&') ||
            (value === '|' && next === '|') ||
            (value === '?' && next === '?')) {
            value += this.advance();
        }

        this.tokens.push({ type: 'OPERATOR', value, line: this.line, column: startCol, start, end: this.current });
    }

    private skipWhitespace() {
        while (!this.isAtEnd() && (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r')) {
            this.advance();
        }
    }

    private skipComment() {
        while (!this.isAtEnd() && this.peek() !== '\n') {
            this.advance();
        }
    }

    // Helper methods
    private isAtEnd(): boolean {
        return this.current >= this.source.length;
    }

    private peek(): string {
        return this.source[this.current] || '\0';
    }

    private peekNext(): string {
        return this.source[this.current + 1] || '\0';
    }

    private peekPrevious(): string {
        return this.source[this.current - 1] || '\0';
    }

    private advance(): string {
        const char = this.source[this.current++];
        this.column++;
        return char;
    }

    private addToken(type: TokenType, value: string) {
        this.tokens.push({ type, value, line: this.line, column: this.column - value.length, start: this.current - value.length, end: this.current });
    }

    private isDigit(char: string): boolean {
        return char >= '0' && char <= '9';
    }

    private isAlpha(char: string): boolean {
        return (char >= 'a' && char <= 'z') ||
            (char >= 'A' && char <= 'Z') ||
            char === '_';
    }

    private isAlphaNumeric(char: string): boolean {
        return this.isAlpha(char) || this.isDigit(char);
    }
}
