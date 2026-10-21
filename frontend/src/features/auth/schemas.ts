import { z } from 'zod';

/**
 * Form rules that mirror the backend request schemas (openapi.json).
 * The backend still validates everything; these only give faster feedback.
 */

const emailField = z
  .string()
  .trim()
  .min(1, { error: 'Enter your email.' })
  .pipe(z.email({ error: 'Enter a valid email address.' }));

/** LoginRequest: email (format email), password (8-128 characters). */
export const loginSchema = z.object({
  email: emailField,
  password: z
    .string()
    .min(1, { error: 'Enter your password.' })
    .max(128, { error: 'Password is at most 128 characters.' }),
});

export type LoginValues = z.infer<typeof loginSchema>;

/**
 * RegisterRequest: full_name (2-100), email (format email), password (8-128).
 * "Confirm password" is checked only in the browser; it is never sent.
 */
export const registerSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, { error: 'Name must be at least 2 characters.' })
      .max(100, { error: 'Name is at most 100 characters.' }),
    email: emailField,
    password: z
      .string()
      .min(8, { error: 'Password must be at least 8 characters.' })
      .max(128, { error: 'Password is at most 128 characters.' }),
    confirm_password: z.string().min(1, { error: 'Re-enter your password.' }),
  })
  .refine((v) => v.password === v.confirm_password, {
    path: ['confirm_password'],
    error: 'Passwords do not match.',
  });

export type RegisterValues = z.infer<typeof registerSchema>;
