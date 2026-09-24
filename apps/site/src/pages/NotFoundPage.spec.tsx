import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('renders the hint text in italics', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    const hint = screen.getByText('נסו את דף הבית');
    expect(hint.closest('i')).toBeTruthy();
  });
});
