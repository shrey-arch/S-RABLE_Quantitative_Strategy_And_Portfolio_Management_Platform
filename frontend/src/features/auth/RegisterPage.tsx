import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router';
import { ApiError, api, unwrap } from '@/api/client';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from './auth-context';
import { AuthLayout } from './AuthLayout';
import { EMAIL_TAKEN_MESSAGE } from './messages';
import { DEFAULT_AFTER_LOGIN } from './return-to';
import { registerSchema, type RegisterValues } from './schemas';

/** Backend field names that have a matching input on this form. */
const FORM_FIELDS = ['full_name', 'email', 'password'] as const;

/** /register - POST /auth/register, then go to /login with the email filled in. */
export default function RegisterPage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: '', email: '', password: '', confirm_password: '' },
  });

  if (state.status === 'authenticated') return <Navigate to={DEFAULT_AFTER_LOGIN} replace />;

  const onSubmit = handleSubmit(async ({ full_name, email, password }) => {
    setFormError(null);
    try {
      await unwrap(api.POST('/auth/register', { body: { full_name, email, password } }));
      navigate('/login', { replace: true, state: { registeredEmail: email } });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('Registration failed. Please try again.');
        return;
      }
      if (error.status === 409) {
        setError('email', { message: EMAIL_TAKEN_MESSAGE }, { shouldFocus: true });
        return;
      }
      // 422: put each backend message under its field when the form has that field.
      let placed = false;
      for (const field of FORM_FIELDS) {
        const message = error.fieldErrors[field];
        if (message) {
          setError(field, { message });
          placed = true;
        }
      }
      if (!placed) setFormError(error.message);
    }
  });

  return (
    <AuthLayout title="Create account" subtitle="Start building and testing strategies.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Full name" error={errors.full_name?.message}>
          {(field) => <Input {...field} autoComplete="name" {...register('full_name')} />}
        </FormField>

        <FormField label="Email" error={errors.email?.message}>
          {(field) => <Input {...field} type="email" autoComplete="email" {...register('email')} />}
        </FormField>

        <FormField label="Password" hint="8 to 128 characters." error={errors.password?.message}>
          {(field) => (
            <PasswordInput {...field} autoComplete="new-password" {...register('password')} />
          )}
        </FormField>

        <FormField label="Confirm password" error={errors.confirm_password?.message}>
          {(field) => (
            <PasswordInput
              {...field}
              autoComplete="new-password"
              {...register('confirm_password')}
            />
          )}
        </FormField>

        {formError && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
