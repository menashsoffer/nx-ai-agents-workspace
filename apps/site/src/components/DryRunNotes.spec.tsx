import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DryRunNoteA } from './DryRunNoteA';
import { DryRunNoteB } from './DryRunNoteB';
import { DryRunNoteC } from './DryRunNoteC';

describe('dry-run notes', () => {
  it('render their static text', () => {
    render(
      <>
        <DryRunNoteA />
        <DryRunNoteB />
        <DryRunNoteC />
      </>,
    );
    for (const x of ['A', 'B', 'C'])
      expect(screen.getByText(`dry run ${x}`)).toBeTruthy();
  });
});
