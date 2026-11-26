import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import { getCatalogState, loadSnapshot, clearCatalog } from '../site.ts';
import { response, TOKEN } from '../../../tests/catalog-fixture.ts';
it('exposes a stable current snapshot and preserves catalog identity on conditional refresh', async () => {
  let calls = 0;
  const spy = mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      Response.json(
        ++calls === 1
          ? response()
          : {
              user_id: response().user_id,
              version: response().version,
              access: response().access,
              unchanged: true,
            },
      ),
    ),
  );
  try {
    await clearCatalog();
    assert.equal(getCatalogState(), null);
    const first = await loadSnapshot(TOKEN);
    assert.equal(getCatalogState(), first);
    assert.equal(getCatalogState(), getCatalogState());
    const second = await loadSnapshot(TOKEN);
    assert.equal(second.suppliers, first.suppliers);
    assert.equal(second.catalog, first.catalog);
    await clearCatalog();
    assert.equal(getCatalogState(), null);
  } finally {
    spy.mock.restore();
    await clearCatalog();
  }
});
