import { render, screen } from '@testing-library/react';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('shows the paragraph text', () => {
    render(<HomePage />);
    expect(screen.getByText('ברוכים הבאים לאתר הבדיקה של הצינור')).toBeTruthy();
  });
});
