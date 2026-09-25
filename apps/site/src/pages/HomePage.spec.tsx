import { render, screen } from '@testing-library/react';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('links to the example site in a new tab', () => {
    render(<HomePage />);
    const link = screen.getByRole('link', { name: 'דוגמה' });
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });
});
