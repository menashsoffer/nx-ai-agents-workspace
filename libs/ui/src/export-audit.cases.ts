import type { ExportedModule } from './conventions-audit.scanner.js';

export interface ExportCase {
  category: string;
  indexText: string;
  modules: ExportedModule[];
  unrecognisedStatements: string[];
}

const value = (specifier = './lib/a/A'): ExportedModule => ({
  specifier,
  isTypeOnly: false,
});

export const EXPORT_CASES: ExportCase[] = [
  {
    category: 'star export',
    indexText: "export * from './lib/a/A';",
    modules: [value()],
    unrecognisedStatements: [],
  },
  {
    category: 'named export',
    indexText: "export { A } from './lib/a/A';",
    modules: [value()],
    unrecognisedStatements: [],
  },
  {
    category: 'inline type specifier',
    indexText: "export { A, type AProps } from './lib/a/A';",
    modules: [value()],
    unrecognisedStatements: [],
  },
  {
    category: 'default alias',
    indexText: "export { default as A } from './lib/a/A';",
    modules: [value()],
    unrecognisedStatements: [],
  },
  {
    category: 'multi-line export',
    indexText: "export {\n  A,\n  type AProps,\n} from './lib/a/A';",
    modules: [value()],
    unrecognisedStatements: [],
  },
  {
    category: 'type-only export',
    indexText: "export type { AProps } from './lib/a/A';",
    modules: [{ ...value(), isTypeOnly: true }],
    unrecognisedStatements: [],
  },
  {
    category: 'type-only export',
    indexText: "export { type AProps } from './lib/a/A';",
    modules: [{ ...value(), isTypeOnly: true }],
    unrecognisedStatements: [],
  },
  {
    category: 'unknown form',
    indexText: "export const A = 1;\nexport { B } from 'pkg';",
    modules: [],
    unrecognisedStatements: ['export const A = 1;', "export { B } from 'pkg';"],
  },
];
