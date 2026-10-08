import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWithGraphErrorDetails } from './testing';

const WORKSPACE_ROOT = join(__dirname, '../../../..');

describe('runWithGraphErrorDetails', () => {
  it('resolves with the generator return value on success', async () => {
    const result = await runWithGraphErrorDetails(async () => 'ok');

    expect(result).toBe('ok');
  });

  it('rethrows a plain error unchanged', async () => {
    const plainError = new Error('boom');

    await expect(
      runWithGraphErrorDetails(async () => {
        throw plainError;
      }),
    ).rejects.toBe(plainError);
  });

  it("appends every inner error's message for a flat duck-typed ProjectGraphError", async () => {
    const graphError = new Error('Failed to process project graph.');
    (graphError as Error & { getErrors: () => Error[] }).getErrors = () => [
      new Error('ProjectsWithNoNameError: apps/docs/.vitepress/.temp'),
      new Error('ProjectsWithNoNameError: apps/docs/.vitepress/cache'),
    ];

    await expect(
      runWithGraphErrorDetails(async () => {
        throw graphError;
      }),
    ).rejects.toMatchObject({
      message:
        'Failed to process project graph.\n' +
        'ProjectsWithNoNameError: apps/docs/.vitepress/.temp\n' +
        'ProjectsWithNoNameError: apps/docs/.vitepress/cache',
    });
  });

  it('descends into an AggregateError with an empty message to find the real inner error', async () => {
    const graphError = new Error('Failed to process project graph.');
    const nestedAggregate = new AggregateError(
      [new Error('ProjectsWithNoNameError: apps/docs/.vitepress/.temp')],
      '',
    );
    (graphError as Error & { getErrors: () => unknown[] }).getErrors = () => [
      nestedAggregate,
    ];

    await expect(
      runWithGraphErrorDetails(async () => {
        throw graphError;
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'ProjectsWithNoNameError: apps/docs/.vitepress/.temp',
      ),
    });
  });

  it('keeps a non-empty AggregateError message alongside its inner messages', async () => {
    const graphError = new Error('Failed to process project graph.');
    const nestedAggregate = new AggregateError(
      [new Error('inner detail')],
      'outer aggregate message',
    );
    (graphError as Error & { getErrors: () => unknown[] }).getErrors = () => [
      nestedAggregate,
    ];

    await expect(
      runWithGraphErrorDetails(async () => {
        throw graphError;
      }),
    ).rejects.toMatchObject({
      message:
        'Failed to process project graph.\n' +
        'outer aggregate message\n' +
        'inner detail',
    });
  });

  it('keeps the .vitepress temp/cache ignore patterns in the root .gitignore', () => {
    const gitignore = readFileSync(join(WORKSPACE_ROOT, '.gitignore'), 'utf-8');

    expect(gitignore).toMatch(/\.vitepress\/\.temp/);
    expect(gitignore).toMatch(/\.vitepress\/cache/);
  });
});
