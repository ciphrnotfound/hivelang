
// JSON Schemas for built-in tools to support AI function calling

export const toolSchemas: Record<string, Record<string, any>> = {
    // ============ GITHUB ============
    "github.createIssue": {
        type: "object",
        properties: {
            title: { type: "string", description: "Title of the issue" },
            body: { type: "string", description: "Body/Description of the issue" },
            repo: { type: "string", description: "Repository name" },
            owner: { type: "string", description: "Repository owner (username or org)" },
            labels: { type: "array", items: { type: "string" }, description: "List of labels to apply" }
        },
        required: ["title", "repo", "owner"]
    },
    "github.createRepo": {
        type: "object",
        properties: {
            name: { type: "string", description: "Name of the new repository" },
            description: { type: "string", description: "Description of the repository" },
            private: { type: "boolean", description: "Whether the repository should be private" }
        },
        required: ["name"]
    },
    "github.createFile": {
        type: "object",
        properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            path: { type: "string", description: "Path to the file to create/update" },
            content: { type: "string", description: "Content of the file" },
            message: { type: "string", description: "Commit message" },
            branch: { type: "string", description: "Branch name (optional)" }
        },
        required: ["owner", "repo", "path", "content", "message"]
    },
    "github.createPullRequest": {
        type: "object",
        properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            title: { type: "string", description: "PR title" },
            body: { type: "string", description: "PR description" },
            head: { type: "string", description: "The name of the branch where your changes are implemented" },
            base: { type: "string", description: "The name of the branch you want the changes pulled into" }
        },
        required: ["owner", "repo", "title", "head", "base"]
    },
    "github.getProfile": {
        type: "object",
        description: "Get the authenticated user's GitHub profile information (username, name, email)",
        properties: {},
        required: []
    },
    "github.getAuthenticatedUser": { // Alias for getProfile
        type: "object",
        description: "Get the authenticated GitHub user",
        properties: {},
        required: []
    },
    "github.getConnectedAccount": { // Alias for getProfile due to hallucination
        type: "object",
        description: "Get the currently connected GitHub account details",
        properties: {},
        required: []
    },
    "github.listRepos": {
        type: "object",
        properties: {},
        required: []
    },
    "integrations.createGithubIssue": { // Alias
        type: "object",
        properties: {
            title: { type: "string", description: "Title of the issue" },
            body: { type: "string", description: "Body/Description of the issue" },
            repo: { type: "string", description: "Repository name" },
            owner: { type: "string", description: "Repository owner (username or org)" },
            labels: { type: "array", items: { type: "string" }, description: "List of labels to apply" }
        },
        required: ["title", "repo", "owner"]
    },

    // ============ NOTION ============
    "notion.createPage": {
        type: "object",
        description: "Create a new page in Notion",
        properties: {
            databaseId: { type: "string", description: "ID of the database to create page in" },
            title: { type: "string", description: "Title of the page" },
            properties: { type: "object", description: "Additional properties for the page (optional)" },
            children: { type: "array", description: "Page content blocks (optional)" }
        },
        required: ["title"]
    },
    "notion.query": {
        type: "object",
        description: "Query a Notion database",
        properties: {
            databaseId: { type: "string", description: "ID of the database to query" },
            filter: { type: "object", description: "Filter conditions (optional)" },
            sorts: { type: "array", description: "Sort order (optional)" }
        },
        required: ["databaseId"]
    },
    "notion.getPage": {
        type: "object",
        description: "Get a specific Notion page by ID",
        properties: {
            pageId: { type: "string", description: "ID of the page to retrieve" }
        },
        required: ["pageId"]
    },
    "notion.updatePage": {
        type: "object",
        description: "Update properties of a Notion page",
        properties: {
            pageId: { type: "string", description: "ID of the page to update" },
            properties: { type: "object", description: "Properties to update" }
        },
        required: ["pageId", "properties"]
    },

    // ============ SOCIAL MEDIA ============
    "twitter.postTweet": {
        type: "object",
        properties: {
            text: { type: "string", description: "Content of the tweet" }
        },
        required: ["text"]
    },
    "social.schedule": {
        type: "object",
        properties: {
            platform: { type: "string", enum: ["twitter", "linkedin"], description: "Platform to post to" },
            content: { type: "string", description: "Content of the post" },
            scheduledFor: { type: "string", description: "ISO date string for when to post (optional)" }
        },
        required: ["platform", "content"]
    },
    "linkedin.post": {
        type: "object",
        properties: {
            text: { type: "string", description: "Content of the post" }
        },
        required: ["text"]
    },

    // ============ COMMUNICATION ============
    "messaging.postSlackMessage": {
        type: "object",
        properties: {
            channel: { type: "string", description: "Channel name (e.g. #general) or ID" },
            text: { type: "string", description: "Message content" }
        },
        required: ["channel", "text"]
    },
    "slack.getChannelHistory": {
        type: "object",
        properties: {
            channel: { type: "string", description: "Channel ID" },
            limit: { type: "number", description: "Number of messages to retrieve" }
        },
        required: ["channel"]
    },
    "slack.send": { // Common alias
        type: "object",
        properties: {
            channel: { type: "string", description: "Channel name (e.g. #general) or ID" },
            message: { type: "string", description: "Message content" }
        },
        required: ["channel", "message"]
    },
    "whatsapp.send": {
        type: "object",
        properties: {
            to: { type: "string", description: "Phone number with country code" },
            message: { type: "string", description: "Message content" }
        },
        required: ["to", "message"]
    },
    "email.send": {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body content" }
        },
        required: ["to", "subject", "body"]
    },
    "gmail.searchEmails": {
        type: "object",
        properties: {
            query: { type: "string", description: "Gmail search query (e.g. 'is:unread', 'from:boss')" },
            maxResults: { type: "number", description: "Max number of emails to return" }
        },
        required: ["query"]
    },

    // ============ PRODUCTIVITY ============
    "calendar.schedule": {
        type: "object",
        properties: {
            summary: { type: "string", description: "Event title" },
            startTime: { type: "string", description: "Start time (ISO string or 'YYYY-MM-DD HH:mm')" },
            endTime: { type: "string", description: "End time (ISO string)" },
            description: { type: "string", description: "Event description/notes" },
            location: { type: "string", description: "Event location" },
            attendees: { type: "array", items: { type: "string" }, description: "List of attendee email addresses" }
        },
        required: ["summary", "startTime", "endTime"]
    },
    "integrations.createNotionPage": {
        type: "object",
        properties: {
            databaseId: { type: "string", description: "ID of the Notion database" },
            title: { type: "string", description: "Title of the new page" },
            // Simplified properties since full Notion schema is complex for LLM validation
        },
        required: ["databaseId", "title"]
    },
    "knowledge.create_kb": {
        type: "object",
        properties: {
            name: { type: "string", description: "Knowledge base name" },
            description: { type: "string", description: "Knowledge base description" }
        },
        required: ["name"]
    },
    "knowledge.list_kbs": {
        type: "object",
        properties: {},
        required: []
    },
    "knowledge.add_document": {
        type: "object",
        properties: {
            kb_id: { type: "string", description: "Knowledge base ID" },
            title: { type: "string", description: "Document title" },
            content: { type: "string", description: "Document content" },
            source_type: { type: "string", description: "Content source type" },
            content_source_url: { type: "string", description: "Source URL" },
            metadata: { type: "object", description: "Additional metadata" }
        },
        required: ["title", "content"]
    },
    "knowledge.add_text": {
        type: "object",
        properties: {
            kb_id: { type: "string", description: "Knowledge base ID" },
            title: { type: "string", description: "Document title" },
            content: { type: "string", description: "Text content" }
        },
        required: ["content"]
    },
    "knowledge.list_documents": {
        type: "object",
        properties: {
            kb_id: { type: "string", description: "Knowledge base ID" }
        },
        required: []
    },
    "knowledge.search": {
        type: "object",
        properties: {
            kb_id: { type: "string", description: "Knowledge base ID" },
            query: { type: "string", description: "Search query" },
            threshold: { type: "number", description: "Similarity threshold" },
            limit: { type: "number", description: "Result count limit" }
        },
        required: ["query"]
    },
    "knowledge.admissions": {
        type: "object",
        properties: {
            kb_id: { type: "string", description: "Knowledge base ID" },
            topic: { type: "string", description: "Admissions topic" },
            college: { type: "string", description: "College name" }
        },
        required: ["topic", "college"]
    },
    "mcp.register_server": {
        type: "object",
        properties: {
            id: { type: "string", description: "Unique server ID" },
            name: { type: "string", description: "Human-friendly server name" },
            url: { type: "string", description: "Base URL for the MCP server" },
            transport: { type: "string", description: "Transport type: http, sse, or stdio" },
            credentials: { type: "object", description: "Auth credentials" },
            connect: { type: "boolean", description: "Connect immediately after registration" }
        },
        required: ["id", "name", "url"]
    },

    // ============ HIVEMIND ============
    "hivemind.getSharedMemory": {
        type: "object",
        properties: {
            key: { type: "string", description: "The memory key to read" }
        },
        required: ["key"]
    },
    "hivemind.setSharedMemory": {
        type: "object",
        properties: {
            key: { type: "string", description: "The memory key to write" },
            value: { type: "string", description: "The value to store" }
        },
        required: ["key", "value"]
    },
    "hivemind.navigateTo": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL to navigate to" }
        },
        required: ["url"]
    },
    "hivemind.generateHiveLang": {
        type: "object",
        properties: {
            description: { type: "string", description: "Description of the API" }
        },
        required: ["description"]
    },
    "hivemind.createIntegration": {
        type: "object",
        properties: {
            name: { type: "string", description: "Integration name" },
            slug: { type: "string", description: "Integration slug" },
            description: { type: "string", description: "Description" },
            code: { type: "string", description: "HiveLang code" },
            category: { type: "string", description: "Category" }
        },
        required: ["name", "slug", "description", "code"]
    },
    "hivemind.createBot": {
        type: "object",
        properties: {
            name: { type: "string", description: "Bot name" },
            instructions: { type: "string", description: "System instructions" },
            capabilities: { type: "array", items: { type: "string" }, description: "Capabilities list" }
        },
        required: ["name", "instructions"]
    },
    "hivemind.runBot": {
        type: "object",
        properties: {
            botId: { type: "string", description: "Bot ID" },
            prompt: { type: "string", description: "Prompt" }
        },
        required: ["botId", "prompt"]
    },
    "hivemind.helpUserWithBot": {
        type: "object",
        properties: {
            botName: { type: "string", description: "Bot name" }
        },
        required: ["botName"]
    },
    "hivemind.listMyIntegrations": {
        type: "object",
        properties: {},
        required: []
    },
    "hivemind.testIntegration": {
        type: "object",
        properties: {
            code: { type: "string", description: "HiveLang code" },
            capability: { type: "string", description: "Capability name" },
            args: { type: "object", description: "Arguments object" }
        },
        required: ["code", "capability", "args"]
    },
    "web.search": {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query" }
        },
        required: ["query"]
    },

    // ============ GENERAL ============
    "general.respond": {
        type: "object",
        properties: {
            prompt: { type: "string", description: "The response text or prompt" }
        },
        required: ["prompt"]
    },
    "general.recordTask": {
        type: "object",
        properties: {
            title: { type: "string", description: "Title of the task" },
            due: { type: "string", description: "Due date (optional)" }
        },
        required: ["title"]
    },

    // ============ PULSE SCHEDULING ============
    "schedule.create": {
        type: "object",
        description: "Create a durable Bothive Pulse schedule for an explicitly requested recurring task.",
        properties: {
            name: { type: "string", description: "Short, human-readable name for the recurring mission" },
            instruction: { type: "string", description: "Exact work the bot must carry out on every run" },
            cron: { type: "string", description: "Five-field cron expression, for example 0 9 * * 1-5" },
            intervalMinutes: { type: "number", description: "Alternative to cron: repeat every positive number of minutes" },
            timezone: { type: "string", description: "IANA timezone, for example Africa/Lagos or UTC" },
            outcome: { type: "string", description: "Expected result or delivery target" },
            stopCondition: { type: "string", description: "When this standing mission should stop" }
        },
        required: ["instruction"]
    },
    "schedule.list": {
        type: "object",
        description: "List this bot's active and paused Pulse schedules.",
        properties: {},
        required: []
    },
    "schedule.pause": {
        type: "object",
        description: "Pause a previously created Pulse schedule.",
        properties: {
            scheduleId: { type: "string", description: "The schedule ID returned by schedule.list or schedule.create" }
        },
        required: ["scheduleId"]
    }
};

export function getToolSchema(toolName: string): Record<string, any> {
    // 1. Remove integration. or integrations. prefix if present
    let normalized = toolName;
    if (normalized.startsWith("integration.")) normalized = normalized.substring(12);
    if (normalized.startsWith("integrations.")) normalized = normalized.substring(13);

    // 2. Exact match on normalized name
    if (toolSchemas[normalized]) {
        return toolSchemas[normalized];
    }

    // 3. Fallback for namespacing/casing differences (e.g. "github.create_repo" vs "github.createRepo")
    const parts = normalized.split('.');
    const simpleName = parts[parts.length - 1].toLowerCase().replace(/_/g, ""); // e.g. "create_repo" -> "createrepo"

    // Search for loose match by comparing case-insensitive, symbol-free suffixes
    const match = Object.keys(toolSchemas).find(k => {
        const kParts = k.split('.');
        const kSimple = kParts[kParts.length - 1].toLowerCase().replace(/_/g, "");
        return kSimple === simpleName;
    });

    if (match) {
        return toolSchemas[match];
    }

    // Default generic schema if unknown
    return {
        type: "object",
        properties: {
            input: { type: "string", description: "Input for the tool" }
        }
    };
}
