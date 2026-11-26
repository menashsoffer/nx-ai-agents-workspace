import { readFile, writeFile } from 'node:fs/promises';

import { migratedDatabase } from '../../supabase/tests/pglite.ts';
import { rpcTypes } from './rpc-types.ts';

interface Column {
  table_name: string;
  table_type: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  identity_generation: string | null;
  is_generated: string;
}

const TYPES: Record<string, string> = {
  text: 'string',
  uuid: 'string',
  date: 'string',
  'timestamp with time zone': 'string',
  integer: 'number',
  bigint: 'number',
  numeric: 'number',
  boolean: 'boolean',
  jsonb: 'Json',
  'ARRAY:_text': 'string[]',
};

function scalar(column: Column): string {
  const key = column.data_type === 'ARRAY' ? `ARRAY:${column.udt_name}` : column.data_type;
  const type = TYPES[key];
  if (!type) throw new Error(`Unsupported PostgreSQL type ${key}`);
  return type;
}

function isOptional(column: Column): boolean {
  return (
    column.is_nullable === 'YES' ||
    column.column_default !== null ||
    column.is_identity === 'YES' ||
    column.is_generated !== 'NEVER'
  );
}

function field(column: Column, mode: 'Row' | 'Insert' | 'Update'): string {
  const generated = column.is_generated !== 'NEVER' || column.identity_generation === 'ALWAYS';
  const optional = mode === 'Update' || (mode === 'Insert' && isOptional(column));
  const type = generated && mode !== 'Row' ? 'never' : scalar(column);
  const nullable = column.is_nullable === 'YES' && type !== 'never' ? ' | null' : '';
  return `      ${JSON.stringify(column.column_name)}${optional ? '?' : ''}: ${type}${nullable};`;
}

function renderTable(name: string, columns: Column[]): string {
  const view = columns[0]?.table_type === 'VIEW';
  const modes = view ? (['Row'] as const) : (['Row', 'Insert', 'Update'] as const);
  const sections = modes.map(
    (mode) => `    ${mode}: {\n${columns.map((column) => field(column, mode)).join('\n')}\n    };`,
  );
  return `  ${JSON.stringify(name)}: {\n${sections.join('\n')}\n  };`;
}

function render(columns: Column[]): string {
  const tables = new Map<string, Column[]>();
  for (const column of columns) {
    const group = tables.get(column.table_name) ?? [];
    group.push(column);
    tables.set(column.table_name, group);
  }
  const header = '// Generated from the Supabase migrations; do not edit.\n';
  const json =
    'export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };\n\n';
  const body = [...tables].map(([name, group]) => renderTable(name, group)).join('\n');
  return `${header}${json}export interface PublicSchema {\n${body}\n}\n`;
}

async function generate(): Promise<string> {
  const db = await migratedDatabase();
  try {
    const result = await db.query<Column>(`select c.table_name, t.table_type, c.column_name,
      c.data_type, c.udt_name, c.is_nullable, c.column_default, c.is_identity,
      c.identity_generation, c.is_generated
      from information_schema.columns c join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type in ('BASE TABLE', 'VIEW')
      order by c.table_name, c.ordinal_position`);
    return render(result.rows) + (await rpcTypes(db));
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  const result = await generate();
  const file = new URL('../../web/src/database.types.ts', import.meta.url);
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== result)
      throw new Error('Database types are out of date');
  } else {
    await writeFile(file, result);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Type generation failed');
  process.exitCode = 1;
});
