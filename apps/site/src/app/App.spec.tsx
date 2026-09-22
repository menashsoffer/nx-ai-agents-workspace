import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App';

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
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('renders the not-found page for unknown routes', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'הדף לא נמצא' })).toBeTruthy();
  });
});
