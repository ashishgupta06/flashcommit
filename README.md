# Flash Commit

Generate a commit message from your staged diff with one click. Uses the Claude Code CLI, the Codex CLI, any OpenAI-compatible API, or the Anthropic Messages API.

## Usage

Click the flash (⚡) icon in the Source Control title bar, or run **Flash Commit: Generate Commit Message** from the Command Palette. The message is written into the commit input box.

## Requirements

- Git
- One of: the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) or [Codex CLI](https://github.com/openai/codex) on your `PATH`, an OpenAI-compatible endpoint, or an Anthropic API key. For the APIs, store the key (encrypted) via the **Set API Key** link under the base URL setting, the **Flash Commit: Set API Key** command, or the button on an auth-error notification.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `flashcommit.provider` | `claude` | `claude`, `codex`, `openai`, or `anthropic` |
| `flashcommit.prompt` | conventional commit prompt | Instruction sent with the diff |
| `flashcommit.claude.path` | `claude` | Path to the Claude Code CLI |
| `flashcommit.claude.model` | `haiku` | Passed as `--model` (empty = CLI default) |
| `flashcommit.claude.allowedTools` | `[]` | Passed as `--allowedTools` |
| `flashcommit.claude.extraArgs` | `[]` | Extra args for `claude -p` |
| `flashcommit.codex.path` | `codex` | Path to the Codex CLI |
| `flashcommit.codex.model` | empty | Passed as `-m` (empty = CLI default) |
| `flashcommit.codex.extraArgs` | `[]` | Extra args for `codex exec` |
| `flashcommit.openai.baseUrl` | `https://api.openai.com/v1` | e.g. `http://localhost:11434/v1` for Ollama |
| `flashcommit.openai.model` | `gpt-4o-mini` | Model name |
| `flashcommit.openai.headers` | `{}` | Extra HTTP headers (override defaults) |
| `flashcommit.anthropic.baseUrl` | `https://api.anthropic.com` | Messages API base URL |
| `flashcommit.anthropic.model` | `claude-haiku-5-5` | Model name |
| `flashcommit.anthropic.headers` | `{}` | Extra HTTP headers (override defaults) |
| `flashcommit.timeoutSeconds` | `60` | Generation timeout |
