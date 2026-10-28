import * as vscode from 'vscode';
import { execFile } from 'child_process';

// Minimal slice of the built-in Git extension API (extensions/git/src/api/git.d.ts).
interface Repository { rootUri: vscode.Uri; inputBox: { value: string } }
interface GitAPI { repositories: Repository[]; getRepository(uri: vscode.Uri): Repository | null }

const KEY = 'flashcommit.openaiKey';

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
		child.stdin?.end(opts.input ?? '');
	});
}

async function viaClaude(diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number) {
	const model = cfg.get<string>('claude.model');
	const tools = cfg.get<string[]>('claude.allowedTools', []);
	// Comma-joined single value so the variadic flag doesn't swallow following args.
	const args = ['-p', prompt, ...(tools.length ? ['--allowedTools', tools.join(',')] : []), ...(model ? ['--model', model] : []), ...cfg.get<string[]>('claude.extraArgs', [])];
	return run(cfg.get<string>('claude.path') || 'claude', args, { input: diff, timeoutMs });
}

async function viaOpenAI(diff: string, cfg: vscode.WorkspaceConfiguration, prompt: string, timeoutMs: number, key?: string) {
	const url = cfg.get<string>('openai.baseUrl', '').replace(/\/+$/, '') + '/chat/completions';
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
		body: JSON.stringify({
			model: cfg.get<string>('openai.model'),
			messages: [{ role: 'system', content: prompt }, { role: 'user', content: diff }],
		}),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) {
		throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
	}
	const data = await res.json() as { choices?: { message?: { content?: string } }[] };
	return data.choices?.[0]?.message?.content ?? '';
}

export function activate(context: vscode.ExtensionContext) {
	const git: GitAPI = vscode.extensions.getExtension('vscode.git')!.exports.getAPI(1);

	context.subscriptions.push(
		vscode.commands.registerCommand('flashcommit.generate', async (sc?: vscode.SourceControl) => {
			const repo = (sc?.rootUri && git.getRepository(sc.rootUri)) || git.repositories[0];
			if (!repo) {
				return vscode.window.showWarningMessage('Flash Commit: no git repository found.');
			}
			const cfg = vscode.workspace.getConfiguration('flashcommit');
			const prompt = cfg.get<string>('prompt', '');
			const timeoutMs = cfg.get<number>('timeoutSeconds', 60) * 1000;
			try {
				await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl }, async () => {
					const cwd = repo.rootUri.fsPath;
					// Staged first; fall back to unstaged like VS Code's smart commit.
					const diff = (await run('git', ['diff', '--cached'], { cwd })) || (await run('git', ['diff'], { cwd }));
					if (!diff.trim()) {
						vscode.window.showInformationMessage('Flash Commit: no changes to describe.');
						return;
					}
					// ponytail: whole diff is sent; truncate when huge diffs start hitting token limits.
					const msg = cfg.get('provider') === 'openai'
						? await viaOpenAI(diff, cfg, prompt, timeoutMs, await context.secrets.get(KEY))
						: await viaClaude(diff, cfg, prompt, timeoutMs);
					if (!msg.trim()) {
						throw new Error('empty response');
					}
					repo.inputBox.value = msg.trim();
				});
			} catch (e) {
				vscode.window.showErrorMessage(`Flash Commit: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('flashcommit.setApiKey', async () => {
			const key = await vscode.window.showInputBox({ prompt: 'OpenAI-compatible API key (empty to clear)', password: true, ignoreFocusOut: true });
			if (key === undefined) {
				return;
			}
			await (key ? context.secrets.store(KEY, key) : context.secrets.delete(KEY));
			vscode.window.showInformationMessage(`Flash Commit: API key ${key ? 'saved' : 'cleared'}.`);
		}),
	);
}

export function deactivate() {}
