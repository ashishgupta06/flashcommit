# Flash Commit

Generate a commit message from your staged diff with one click. Uses the Claude Code CLI or any OpenAI-compatible API.

## Usage

Click the sparkle icon in the Source Control title bar, or run **Flash Commit: Generate Commit Message** from the Command Palette. The message is written into the commit input box.

## Requirements

- Git
- Either the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) on your `PATH`, or an OpenAI-compatible endpoint (run **Flash Commit: Set OpenAI API Key** to store the key).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `flashcommit.provider` | `claude` | `claude` or `openai` |
| `flashcommit.prompt` | conventional commit prompt | Instruction sent with the diff |
| `flashcommit.claude.path` | `claude` | Path to the Claude Code CLI |
| `flashcommit.claude.model` | `haiku` | Passed as `--model` (empty = CLI default) |
| `flashcommit.claude.allowedTools` | `[]` | Passed as `--allowedTools` |
| `flashcommit.claude.extraArgs` | `[]` | Extra args for `claude -p` |
| `flashcommit.openai.baseUrl` | `https://api.openai.com/v1` | e.g. `http://localhost:11434/v1` for Ollama |
| `flashcommit.openai.model` | `gpt-4o-mini` | Model name |
| `flashcommit.timeoutSeconds` | `60` | Generation timeout |
