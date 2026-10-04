import { render, screen } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router';
import { App } from './App';
import { routes } from './routes';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

// import.meta.env.BASE_URL drives both the router basename (main.tsx) and
// every BASE_URL-based asset reference (e.g. the logo <img>), so it is
// stubbed to match the basename used in these tests.
function renderUnderPagesBasePath(path: string) {
  vi.stubEnv('BASE_URL', '/repo/');
  window.history.pushState({}, '', `/repo/${path}`.replace(/\/+/g, '/'));
  return render(
    <BrowserRouter basename="/repo/">
      <App />
    </BrowserRouter>,
  );
}

describe('App', () => {
  it('renders the home page at /', () => {
    renderAt('/');
    expect(
      screen.getByRole('heading', { name: 'NX AI Pipeline' }),
    ).toBeTruthy();
  });

  it('renders the about page at /about', () => {
    renderAt('/about');
    expect(screen.getByRole('heading', { name: 'אודות' })).toBeTruthy();
  });

  it('renders the not-found page for unknown routes', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'הדף לא נמצא' })).toBeTruthy();
  });

  it('links every nav route', () => {
    renderAt('/');
    for (const route of routes.filter((route) => route.navLabel)) {
      expect(screen.getByRole('link', { name: route.navLabel })).toBeTruthy();
    }
  });
});

// The Pages deployment reserves these top-level paths (docs/architecture.md):
// /storybook/ (libs/ui Storybook), /docs/ (apps/docs) and /pr-<n>/ (PR
// previews of apps/site). A site route there would never be reachable.
const RESERVED_TOP_LEVEL_PATHS = ['storybook', 'docs'];
const RESERVED_PR_PREVIEW_PATTERN = /^pr-\d+$/;

describe('routes', () => {
  it('never claims a path reserved by the Pages deployment', () => {
    for (const route of routes) {
      const firstSegment = route.path.split('/')[0];
      expect(RESERVED_TOP_LEVEL_PATHS).not.toContain(firstSegment);
      expect(firstSegment).not.toMatch(RESERVED_PR_PREVIEW_PATTERN);
    }
  });
});

describe('App under the Pages base path', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['/', '/about'])(
    'keeps every link and image under the base path at %s',
    (path) => {
      const { container } = renderUnderPagesBasePath(path);
      const links = screen.getAllByRole('link');
      const images = container.querySelectorAll('img');
      expect(links.length + images.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.getAttribute('href')).toMatch(/^\/repo\//);
      }
      for (const image of images) {
        expect(image.getAttribute('src')).toMatch(/^\/repo\//);
      }
    },
  );
});
