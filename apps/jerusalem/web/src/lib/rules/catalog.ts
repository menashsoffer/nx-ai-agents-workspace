import { accessReasonProblem, jobTitleProblem, personNameProblem } from './access.ts';
import { dateProblem } from './dates.ts';
import type { RuleKey } from './messages.ts';
import { amountProblem, exemptionProblem, noteProblem, subjectProblem } from './requests.ts';
import {
  addressProblem,
  emailProblem,
  identifierProblem,
  nameProblem,
  personProblem,
  phoneProblem,
  reasonProblem,
  sourceProblem,
  websiteProblem,
} from './supplier.ts';

/**
 * Every value rule by the name `private.rule_problem(name, value)` uses in the database.
 * The contract test runs each case through both and expects the same key.
 */
export const RULES: Record<string, (value: string) => RuleKey | null> = {
  supplier_name: nameProblem,
  phone: phoneProblem,
  email: emailProblem,
  website: websiteProblem,
  address: addressProblem,
  contact_person: personProblem,
  status_reason: reasonProblem,
  status_source: sourceProblem,
  'identifier:company': (value) => identifierProblem('company', value),
  'identifier:nonprofit': (value) => identifierProblem('nonprofit', value),
  'identifier:vat_dealer': (value) => identifierProblem('vat_dealer', value),
  engagement_subject: subjectProblem,
  amount: amountProblem,
  exemption: exemptionProblem,
  decision_note: noteProblem,
  person_name: personNameProblem,
  job_title: jobTitleProblem,
  access_reason: accessReasonProblem,
  /** Dates are checked against a fixed "today" so the contract does not depend on the clock. */
  date: (value) => dateProblem(value, '2026-11-17'),
};
