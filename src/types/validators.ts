/**
 * Hand-rolled validation primitives.
 *
 * A Validator receives untrusted input and returns either the normalized value
 * or a list of human-readable errors. This keeps validation dependency-free
 * while still being type-safe at the call site.
 */

export type ValidationSuccess<T> = { ok: true; value: T };
export type ValidationFailure = { ok: false; errors: string[] };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export type Validator<T> = (input: unknown) => ValidationResult<T>;

export type ValidatorShape<T> = {
  [K in keyof T]-?: Validator<T[K]>;
};
