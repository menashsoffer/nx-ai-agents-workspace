import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>שמירה</Button>);
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeTruthy();
  });

  it('defaults to type="button" so it never submits forms by accident', () => {
    render(<Button>שמירה</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});
