import { textProblem } from './text.ts';

/** The access form and change requests (documentation/validation-rules-he.md, section 3). */
export const personNameProblem = (value: string) =>
  textProblem(value, { min: 2, max: 100, letters: 2 });

export const jobTitleProblem = (value: string) =>
  textProblem(value, { min: 2, max: 200, letters: 2 });

export const accessReasonProblem = (value: string) =>
  textProblem(value, { min: 5, max: 1000, letters: 2 });
