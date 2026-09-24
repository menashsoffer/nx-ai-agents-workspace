import { render, screen } from '@testing-library/react';
import { AboutPage } from './AboutPage';

describe('AboutPage', () => {
  it('renders the footer note', () => {
    render(<AboutPage />);
    expect(screen.getByText('סוף העמוד')).toBeTruthy();
  });
});
