import { render, screen } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router';
import { App } from './App';
import { collectSpikes, spikes as realSpikes } from './spikes';

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

function renderUnderPagesBasePath(path: string, spikes = fixtureSpikes) {
  window.history.pushState({}, '', `/repo/${path}`.replace(/\/+/g, '/'));
  return render(
    <BrowserRouter basename="/repo/">
      <App spikes={spikes} />
    </BrowserRouter>,
  );
}

describe('Sandbox App', () => {
  it('lists spikes newest first, falling back to the folder name', () => {
    renderAt('/');
    const links = screen.getAllByRole('link').slice(1); // skip the nav link
    expect(links.map((link) => link.textContent)).toEqual([
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

// sandbox is never deployed to Pages (docs/architecture.md), but it shares
// the deployment's reserved top-level paths (/storybook/, /docs/, /pr-<n>/)
// for consistency: a spike folder named like one would be confusing even
// though sandbox routes are never actually served there.
const RESERVED_TOP_LEVEL_PATHS = ['storybook', 'docs'];
const RESERVED_PR_PREVIEW_PATTERN = /^pr-\d+$/;

describe('routes', () => {
  it('never claims a path reserved by the Pages deployment', () => {
    for (const { slug } of [...fixtureSpikes, ...realSpikes]) {
      expect(RESERVED_TOP_LEVEL_PATHS).not.toContain(slug);
      expect(slug).not.toMatch(RESERVED_PR_PREVIEW_PATTERN);
    }
  });
});

describe('App under the Pages base path', () => {
  it('keeps every link under the base path at /', () => {
    renderUnderPagesBasePath('/');
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/repo\//);
    }
  });

  it('keeps every link under the base path on a spike route', async () => {
    renderUnderPagesBasePath('/2026-02-newer');
    expect(
      await screen.findByRole('heading', { name: 'Newer content' }),
    ).toBeTruthy();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/repo\//);
    }
  });
});
