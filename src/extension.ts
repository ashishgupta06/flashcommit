import * as vscode from 'vscode';
import { execFile } from 'child_process';

// Minimal slice of the built-in Git extension API (extensions/git/src/api/git.d.ts).
interface Repository { rootUri: vscode.Uri; inputBox: { value: string } }
interface GitAPI { repositories: Repository[]; getRepository(uri: vscode.Uri): Repository | null }

const KEYS = { openai: 'flashcommit.openaiKey', anthropic: 'flashcommit.anthropicKey' };

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) {
				const code = (err as NodeJS.ErrnoException).code;
				reject(new Error(code === 'ENOENT' ? `"${cmd}" not found` : (stderr.trim() || err.message)));
			} else {
				resolve(stdout);
			}
		});
		// Early CLI exit → EPIPE here; the exit itself is already reported via the callback.
		child.stdin?.on('error', () => {});
		child.stdin?.end(opts.input ?? '');
	});
}

async function postJson(baseUrl: string, path: string, headers: Record<string, string>, overrides: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
	// Headers is case-insensitive, so user overrides replace defaults instead of duplicating them.
	const h = new Headers(headers);
	for (const [k, v] of Object.entries(overrides)) {
		h.set(k, v);
	}
	const res = await fetch(baseUrl.replace(/\/+$/, '') + path, { method: 'POST', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) {
		throw Object.assign(new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`), { status: res.status });
	}
	return res.json();
}

async function viaClaude(diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number, cwd: string) {
	const model = cfg.get<string>('claude.model');
	const tools = cfg.get<string[]>('claude.allowedTools', []);
	// Comma-joined single value so the variadic flag doesn't swallow following args.
	const args = ['-p', prompt, ...(tools.length ? ['--allowedTools', tools.join(',')] : []), ...(model ? ['--model', model] : []), ...cfg.get<string[]>('claude.extraArgs', [])];
	return run(cfg.get<string>('claude.path') || 'claude', args, { cwd, input: diff, timeoutMs });
}

async function viaOpenAI(diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number, key?: string) {
	const data = await postJson(
		cfg.get<string>('openai.baseUrl', ''), '/chat/completions',
		{ 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
		cfg.get<Record<string, string>>('openai.headers', {}),
		{ model: cfg.get<string>('openai.model'), messages: [{ role: 'system', content: prompt }, { role: 'user', content: diff }] },
		timeoutMs,
	) as { choices?: { message?: { content?: string } }[] };
	return data.choices?.[0]?.message?.content ?? '';
}

async function viaCodex(diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number, cwd: string) {
	const model = cfg.get<string>('codex.model');
	// "-" reads the prompt from stdin; exec prints only the final message to stdout (progress goes to stderr).
	const args = ['exec', '--sandbox', 'read-only', ...(model ? ['-m', model] : []), ...cfg.get<string[]>('codex.extraArgs', []), '-'];
	return run(cfg.get<string>('codex.path') || 'codex', args, { cwd, input: `${prompt}\n\n${diff}`, timeoutMs });
}

async function viaAnthropic(diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number, key?: string) {
	const data = await postJson(
		cfg.get<string>('anthropic.baseUrl', ''), '/v1/messages',
		{ 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) },
		cfg.get<Record<string, string>>('anthropic.headers', {}),
		{ model: cfg.get<string>('anthropic.model'), max_tokens: 1024, system: prompt, messages: [{ role: 'user', content: diff }] },
		timeoutMs,
	) as { content?: { type: string; text?: string }[] };
	return (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function generate(provider: unknown, diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number, cwd: string, secrets: vscode.SecretStorage) {
	switch (provider) {
		case 'openai': return secrets.get(KEYS.openai).then(key => viaOpenAI(diff, cfg, prompt, timeoutMs, key));
		case 'anthropic': return secrets.get(KEYS.anthropic).then(key => viaAnthropic(diff, cfg, prompt, timeoutMs, key));
		case 'codex': return viaCodex(diff, cfg, prompt, timeoutMs, cwd);
		default: return viaClaude(diff, cfg, prompt, timeoutMs, cwd);
	}
}

// Chat models often wrap the answer in a ``` fence despite the prompt.
export function cleanMessage(msg: string) {
	return msg.trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/, '$1').trim();
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('flashcommit.generate', async (sc?: vscode.SourceControl) => {
			let git: GitAPI;
			try {
				git = vscode.extensions.getExtension('vscode.git')!.exports.getAPI(1);
			} catch {
				return vscode.window.showWarningMessage('Flash Commit: the built-in Git extension is disabled ("git.enabled").');
			}
			const editorUri = vscode.window.activeTextEditor?.document.uri;
			const repo = (sc?.rootUri && git.getRepository(sc.rootUri)) || (editorUri && git.getRepository(editorUri)) || git.repositories[0];
			if (!repo) {
				return vscode.window.showWarningMessage('Flash Commit: no git repository found.');
			}
			const cfg = vscode.workspace.getConfiguration('flashcommit');
			const prompt = cfg.get<string>('prompt', '');
			const timeoutMs = Math.max(1, cfg.get<number>('timeoutSeconds', 60)) * 1000;
			try {
				await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl }, async () => {
					const cwd = repo.rootUri.fsPath;
					// Staged first; fall back to unstaged like VS Code's smart commit.
					// Ignore user color/external-diff config so the model gets a plain unified diff.
					const diff = (await run('git', ['diff', '--no-color', '--no-ext-diff', '--cached'], { cwd })) || (await run('git', ['diff', '--no-color', '--no-ext-diff'], { cwd }));
					if (!diff.trim()) {
						vscode.window.showInformationMessage('Flash Commit: no changes to describe.');
						return;
					}
					// ponytail: whole diff is sent; truncate when huge diffs start hitting token limits.
					const msg = cleanMessage(await generate(cfg.get('provider'), diff, cfg, prompt, timeoutMs, cwd, context.secrets));
					if (!msg) {
						throw new Error('empty response');
					}
					repo.inputBox.value = msg;
				});
			} catch (e) {
				const provider = cfg.get<string>('provider');
				const authFailed = (provider === 'openai' || provider === 'anthropic') && [401, 403].includes((e as { status?: number }).status!);
				const action = await vscode.window.showErrorMessage(`Flash Commit: ${(e as Error).message}`, ...(authFailed ? ['Set API Key'] : []));
				if (action) {
					vscode.commands.executeCommand('flashcommit.setApiKey', provider);
				}
			}
		}),
		vscode.commands.registerCommand('flashcommit.setApiKey', async (id?: keyof typeof KEYS) => {
			const current = vscode.workspace.getConfiguration('flashcommit').get<string>('provider');
			// Current provider first so Enter picks it (`picked` is ignored in single-select).
			const order = current === 'anthropic' ? ['anthropic', 'openai'] as const : ['openai', 'anthropic'] as const;
			const items = order.map(p => ({ id: p, label: p === 'openai' ? 'OpenAI-compatible' : 'Anthropic' }));
			// Settings links and the error toast pass the provider; the palette asks.
			const which = items.find(i => i.id === id) ?? await vscode.window.showQuickPick(items, { placeHolder: 'Which API key?' });
			if (!which) {
				return;
			}
			const key = await vscode.window.showInputBox({ prompt: `${which.label} API key (empty to clear)`, password: true, ignoreFocusOut: true });
			if (key === undefined) {
				return;
			}
			await (key ? context.secrets.store(KEYS[which.id], key) : context.secrets.delete(KEYS[which.id]));
			vscode.window.showInformationMessage(`Flash Commit: ${which.label} API key ${key ? 'saved' : 'cleared'}.`);
		}),
	);
}

export function deactivate() {}
