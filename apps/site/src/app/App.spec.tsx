import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App';
import { routes } from './routes';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
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
    for (const route of routes.filter((r) => r.navLabel)) {
      expect(screen.getByRole('link', { name: route.navLabel })).toBeTruthy();
    }
  });
});

// The Pages deployment serves Storybook at /<repo>/storybook/ (tools/pages).
// A site route there would never be reachable, so it is forbidden.
const RESERVED_TOP_LEVEL_PATHS = ['storybook'];

describe('routes', () => {
  it('never claims a path reserved by the Pages deployment', () => {
    for (const route of routes) {
      const firstSegment = route.path.split('/')[0];
      expect(RESERVED_TOP_LEVEL_PATHS).not.toContain(firstSegment);
    }
  });
});
