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
    'match', 'case', 'while', 'break', 'validate', 'log', 'metric', 'assert', 'mask', 'transform'
    , 'grounding', 'required', 'optional', 'off', 'cite_sources', 'on_missing',
    'memory', 'mode', 'ttl', 'remember_only', 'never_remember', 'none', 'session', 'durable'
]);

export class Tokenizer {
    private source: string;
    private tokens: Token[] = [];
    private current = 0;
    private line = 1;
    private column = 1;

    constructor(source: string) {
        this.source = source;
    }

    tokenize(): Token[] {
        while (!this.isAtEnd()) {
            this.scanToken();
        }
        this.tokens.push({ type: 'EOF', value: '', line: this.line, column: this.column });
        return this.tokens;
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

        // Unknown character - skip
        this.advance();
    }

    private scanString(quote: string) {
        const startLine = this.line;
        const startCol = this.column;
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
        }

        this.tokens.push({ type: 'STRING', value, line: startLine, column: startCol });
    }

    private scanFString(quote: string) {
        const startLine = this.line;
        const startCol = this.column;
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
        }

        this.tokens.push({ type: 'FSTRING', value, line: startLine, column: startCol });
    }

    private scanNumber() {
        const startCol = this.column;
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

        this.tokens.push({ type: 'NUMBER', value, line: this.line, column: startCol });
    }

    private scanIdentifier() {
        const startCol = this.column;
        let value = '';

        while (this.isAlphaNumeric(this.peek())) {
            value += this.advance();
        }

        const type: TokenType = KEYWORDS.has(value) ? 'KEYWORD' : 'IDENTIFIER';
        this.tokens.push({ type, value, line: this.line, column: startCol });
    }

    private scanOperator() {
        const startCol = this.column;
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

        this.tokens.push({ type: 'OPERATOR', value, line: this.line, column: startCol });
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
        this.tokens.push({ type, value, line: this.line, column: this.column - value.length });
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
