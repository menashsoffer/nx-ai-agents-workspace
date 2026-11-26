// What the dashboard computes from the summary: totals, one row per day, screens with their
// share of exits, and a funnel per wizard.
import type { UsageSummary } from '../api/usage.ts';
import { daysOf, type Range } from './range.ts';

export interface Totals {
  visits: number;
  /** People are counted per day (the key changes daily), so this is the daily average. */
  dailyVisitors: number;
  averageVisitMs: number;
  actions: number;
}

export function totals(summary: UsageSummary, range: Range): Totals {
  const visits = summary.days.reduce((n, d) => n + d.visits, 0);
  const visitors = summary.days.reduce((n, d) => n + d.visitors, 0);
  return {
    visits,
    dailyVisitors: Math.round((visitors / range.days) * 10) / 10,
    averageVisitMs: summary.ended_visits ? summary.visit_ms / summary.ended_visits : 0,
    actions: summary.actions.reduce((n, a) => n + a.count, 0),
  };
}

export interface DayRow {
  day: string;
  visits: number;
  visitors: number;
}

export function dayRows(summary: UsageSummary, range: Range): DayRow[] {
  return daysOf(range).map((day) => {
    const rows = summary.days.filter((d) => d.day === day);
    return {
      day,
      visits: rows.reduce((n, d) => n + d.visits, 0),
      visitors: rows.reduce((n, d) => n + d.visitors, 0),
    };
  });
}

export interface ScreenRow {
  screen: string;
  views: number;
  averageMs: number;
  /** Share of all ended visits that ended on this screen, 0 to 1. */
  exitShare: number;
}

export function screenRows(summary: UsageSummary): ScreenRow[] {
  return summary.screens.map((s) => ({
    screen: s.screen,
    views: s.views,
    averageMs: s.views ? s.total_ms / s.views : 0,
    exitShare: summary.ended_visits ? s.exits / summary.ended_visits : 0,
  }));
}

export interface Funnel {
  screen: string;
  steps: { step: number; visits: number; share: number }[];
}

/** Each step as a share of the busiest one, which is normally step 1. */
export function funnels(summary: UsageSummary): Funnel[] {
  const screens = [...new Set(summary.steps.map((s) => s.screen))];
  return screens.map((screen) => {
    const steps = summary.steps.filter((s) => s.screen === screen);
    const base = Math.max(...steps.map((s) => s.visits), 1);
    return {
      screen,
      steps: steps.map((s) => ({ step: s.step, visits: s.visits, share: s.visits / base })),
    };
  });
}

const number = new Intl.NumberFormat('he-IL');
const percent = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return number.format(value);
}

export function formatShare(value: number): string {
  return percent.format(value);
}

/** "1:20 דק׳" or "45 שנ׳". */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} שנ׳`;
  const rest = String(seconds % 60).padStart(2, '0');
  return `${String(Math.floor(seconds / 60))}:${rest} דק׳`;
}
