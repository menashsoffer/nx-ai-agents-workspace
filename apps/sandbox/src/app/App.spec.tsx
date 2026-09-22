import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App';

describe('Sandbox App', () => {
  it('lists the available spikes', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Sandbox' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'כרטיס RTL לדוגמה' })).toBeTruthy();
  });
});
