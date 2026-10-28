import * as assert from 'assert';
import { cleanMessage } from '../extension';

suite('cleanMessage', () => {
	test('strips a wrapping code fence', () => {
		assert.strictEqual(cleanMessage('```\nfeat: add codex\n\nbody\n```\n'), 'feat: add codex\n\nbody');
		assert.strictEqual(cleanMessage('```text\nfix: x\n```'), 'fix: x');
	});
	test('leaves plain messages and inner fences alone', () => {
		assert.strictEqual(cleanMessage('  fix: x \n'), 'fix: x');
		assert.strictEqual(cleanMessage('docs: usage\n\n```\nnpm i\n```'), 'docs: usage\n\n```\nnpm i\n```');
	});
});
