import { render, screen } from '@testing-library/react';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('shows the paragraph text', () => {
    render(<HomePage />);
    expect(screen.getByText('ברוכים הבאים לאתר הבדיקה של הצינור')).toBeTruthy();
  });

  it('links to the static code map in a new tab', () => {
    render(<HomePage />);
    const link = screen.getByRole('link', { name: /מפת קוד/ });
    expect(link.getAttribute('href')).toBe(
      `${import.meta.env.BASE_URL}code-map/`,
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
