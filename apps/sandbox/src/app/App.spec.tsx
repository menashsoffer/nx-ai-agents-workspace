import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App';
import { collectSpikes } from './spikes';

// Tests use their own spike data so deleting or adding real spikes in
// src/spikes/ never breaks them.
const fixtureSpikes = collectSpikes(
  {
    '../spikes/2026-01-older/meta.ts': { title: 'Older spike' },
    '../spikes/2026-02-newer/meta.ts': {
      title: 'Newer spike',
      description: 'Does it work?',
    },
  },
  {
    '../spikes/2026-01-older/index.tsx': async () => ({
      default: () => <h2>Older content</h2>,
    }),
    '../spikes/2026-02-newer/index.tsx': async () => ({
      default: () => <h2>Newer content</h2>,
    }),
    '../spikes/2026-03-no-meta/index.tsx': async () => ({
      default: () => <h2>No meta</h2>,
    }),
  },
);

function renderAt(path: string, spikes = fixtureSpikes) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App spikes={spikes} />
    </MemoryRouter>,
  );
}

describe('Sandbox App', () => {
  it('lists spikes newest first, falling back to the folder name', () => {
    renderAt('/');
    const links = screen.getAllByRole('link').slice(1); // skip the nav link
    expect(links.map((a) => a.textContent)).toEqual([
      '2026-03-no-meta',
      'Newer spike',
      'Older spike',
    ]);
    expect(screen.getByText(/Does it work\?/)).toBeTruthy();
  });

  it('shows an empty state when there are no spikes', () => {
    renderAt('/', []);
    expect(screen.getByText(/אין ניסויים עדיין/)).toBeTruthy();
  });

  it('lazy-loads a spike on its route', async () => {
    renderAt('/2026-02-newer');
    expect(
      await screen.findByRole('heading', { name: 'Newer content' }),
    ).toBeTruthy();
  });
});
