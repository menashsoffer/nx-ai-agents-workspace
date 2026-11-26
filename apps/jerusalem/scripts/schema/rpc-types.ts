import type { PGlite } from '@electric-sql/pglite';

interface Rpc {
  name: string;
  argument: string;
  type: string;
  optional: boolean;
}

/** Keep the new data-loading RPC signatures tied to the migrated database. */
export async function rpcTypes(db: PGlite): Promise<string> {
  const result = await db.query<Rpc>(`select p.proname as name,
    p.proargnames[1] as argument, (p.proargtypes[0]::regtype)::text as type,
    p.pronargdefaults > 0 as optional from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('catalog_snapshot', 'supplier_detail') order by p.proname`);
  const entries = result.rows.map((rpc) => {
    if (!['uuid', 'text'].includes(rpc.type)) throw new Error('Unexpected RPC argument type');
    return `  ${rpc.name}: {\n    Args: { ${rpc.argument}${rpc.optional ? '?' : ''}: string${rpc.optional ? ' | null' : ''} };\n    Returns: Json;\n  };`;
  });
  return `\nexport interface PublicFunctions {\n${entries.join('\n')}\n}\n`;
}
