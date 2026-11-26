import type { Json } from '../database.types.ts';
import { DataError } from './client.ts';

export type Schema<T> = { [K in keyof T]: (value: unknown) => T[K] };

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DataError(0);
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new DataError(0);
  return value as unknown[];
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new DataError(0);
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new DataError(0);
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DataError(0);
  return value;
}
export function nullable<T>(parse: (value: unknown) => T): (value: unknown) => T | null {
  return (value) => (value === null ? null : parse(value));
}
export function json(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return number(value);
  if (Array.isArray(value)) return array(value).map(json);
  return Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, json(item)]));
}

/** Every declared column is validated before this becomes an application model. */
export function tuple<T>(value: unknown, schema: Schema<T>): T {
  const values = array(value);
  const keys = Object.keys(schema) as (keyof T)[];
  if (values.length !== keys.length) throw new DataError(0);
  const result: Partial<T> = {};
  keys.forEach((key, index) => {
    result[key] = schema[key](values[index]);
  });
  return result as T;
}
export function record<T>(value: unknown, schema: Schema<T>): T {
  const data = object(value);
  const result: Partial<T> = {};
  for (const key of Object.keys(schema) as (keyof T)[]) {
    result[key] = schema[key](data[String(key)]);
  }
  return result as T;
}
export function rows<T>(value: unknown, schema: Schema<T>): T[] {
  return array(value).map((row) => tuple(row, schema));
}
