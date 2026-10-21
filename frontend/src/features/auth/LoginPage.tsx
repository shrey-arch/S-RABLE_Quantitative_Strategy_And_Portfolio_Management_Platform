import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Info } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth, type SessionEndReason } from './auth-context';
import { AuthLayout } from './AuthLayout';
import { INACTIVE_ACCOUNT_MESSAGE, SESSION_EXPIRED_MESSAGE, loginErrorMessage } from './messages';
import { safeReturnTo } from './return-to';
import { loginSchema, type LoginValues } from './schemas';

interface LoginLocationState {
  from?: string;
  reason?: SessionEndReason;
  registeredEmail?: string;
}

const REASON_MESSAGES: Record<SessionEndReason, string> = {
  expired: SESSION_EXPIRED_MESSAGE,
  inactive: INACTIVE_ACCOUNT_MESSAGE,
};

/** /login - email + password. After success, returns to the page the user originally asked for. */
export default function LoginPage() {
  const { state, login, endReason } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = (location.state ?? {}) as LoginLocationState;
  const returnTo = safeReturnTo(navState.from);

  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: navState.registeredEmail ?? '', password: '' },
  });

  // Already logged in: go straight to the app.
  if (state.status === 'authenticated') return <Navigate to={returnTo} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      navigate(returnTo, { replace: true });
    } catch (error) {
      setFormError(loginErrorMessage(error));
    }
  });

  const reason = navState.reason ?? endReason;
  const notice = navState.registeredEmail
    ? 'Account created. Log in to continue.'
    : reason
      ? REASON_MESSAGES[reason]
      : null;

  return (
    <AuthLayout title="Log in" subtitle="Welcome back to S-RABLE.">
      {notice && (
        <div
          role="status"
          className="mb-4 flex gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Email" error={errors.email?.message}>
          {(field) => <Input {...field} type="email" autoComplete="email" {...register('email')} />}
        </FormField>

        <FormField label="Password" error={errors.password?.message}>
          {(field) => (
            <PasswordInput {...field} autoComplete="current-password" {...register('password')} />
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
          {isSubmitting ? 'Logging in...' : 'Log in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to S-RABLE?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
