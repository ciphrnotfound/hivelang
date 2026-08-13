# HiveLang in Bothive

HiveLang is the custom DSL used by Bothive to define agents. The Bothive application parses HiveLang v5 programs, creates a v5 runtime, registers authorized tools, and executes the selected bot through its production agent pipeline.

The open-source package contains the portable language layer:

- HiveLang v5 tokenizer, parser, AST, and runtime
- tool-capability declarations and tool-call loop
- agent delegation and hierarchical execution

The Bothive application adds its own deployment layer: authentication and tenant isolation, AI-provider configuration, integration/OAuth management, database persistence, usage metering, and operational logging. These concerns deliberately remain outside the language runtime so HiveLang can be embedded in other applications safely.

## Keeping releases aligned

Bothive maintainers should release a new version here whenever a language or runtime change is promoted for production use in Bothive. The package version is the compatible HiveLang version; Bothive application releases may move independently.
