// engine.mjs commands for the notes and texts publish steps post
// (engine-notes.mjs). Each writes or checks; none posts.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setOutput } from './github.mjs';
import { parseFlags } from './pipeline-lib.mjs';
import {
  developNote,
  enginePromptVersion,
  outputNote,
  publishedNote,
  requestNote,
  safeNote,
} from './engine-notes.mjs';
import { secretKinds } from './engine-request.mjs';
import { failOn } from './engine-cli-support.mjs';

const versionOf = (flags) =>
  enginePromptVersion(flags['prompt-name'], readFileSync(flags.prompt, 'utf8'));

export const noteCommands = {
  // Outputs `version`: <prompt-name>@<version> of the engine's own prompt.
  'prompt-version'(args) {
    setOutput('version', versionOf(parseFlags(args)));
  },

  // Writes a safe outcome note (--out) of one --kind: request or output
  // (from validated --findings), develop (from job results and the
  // developer's status and problem code only) or published (--pr). Exit 1
  // if the rendered note would hold a secret-shaped value.
  'safe-note'(args) {
    const flags = parseFlags(args);
    const notes = {
      request: () => requestNote(flags.stage, flags.findings),
      output: () => outputNote(flags.stage, flags.findings),
      develop: () =>
        developNote({
          implementResult: flags['job-result'],
          publishResult: flags['publish-result'],
          raw: flags.result ? readFileSync(flags.result, 'utf8') : '',
          patchRejected: flags['patch-rejected'] === 'true',
        }),
      published: () => publishedNote(flags.pr),
    };
    if (!Object.hasOwn(notes, flags.kind))
      failOn([`unknown kind ${flags.kind}`], 'Note');
    const note = safeNote(notes[flags.kind](), {
      promptVersionText: versionOf(flags),
    });
    writeFileSync(flags.out, JSON.stringify(note));
  },

  // Exit 1 when any --text file holds a secret-shaped value (names only).
  'check-text'(args) {
    const flags = parseFlags(args);
    failOn(
      []
        .concat(flags.text ?? [])
        .flatMap((path) =>
          secretKinds(readFileSync(path, 'utf8')).map(
            (kind) => `${basename(path)} holds a secret-shaped value (${kind})`,
          ),
        ),
      'Text',
    );
  },
};
