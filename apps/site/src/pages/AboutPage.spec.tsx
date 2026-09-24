import { render } from '@testing-library/react';
import { AboutPage } from './AboutPage';

describe('AboutPage', () => {
  it('renders the demo note as bold text', () => {
    const { container } = render(<AboutPage />);
    const bold = container.querySelector('b');
    expect(bold).toBeTruthy();
    expect(bold?.textContent).toBe('הערת בדיקה');
  });
});
