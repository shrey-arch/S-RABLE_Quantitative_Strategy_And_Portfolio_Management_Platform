import { AlertCircle, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/features/auth/auth-context';
import { formatDateTime } from '@/lib/format';
import { initials } from '@/lib/initials';
import {
  buildUpdate,
  draftOf,
  hasChanges,
  type Profile,
  type ProfileDraft,
  type ProfileUpdate,
} from './profile-model';

function Avatar({ profile }: { profile: Profile }) {
  const [broken, setBroken] = useState<string | null>(null);
  const url = profile.profile_image_url;
  if (url && broken !== url)
    return (
      <img
        src={url}
        alt="Profile image"
        referrerPolicy="no-referrer"
        onError={() => setBroken(url)}
        className="size-16 rounded-full border object-cover"
      />
    );
  return (
    <span
      aria-hidden
      className="flex size-16 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground"
    >
      {initials(profile.full_name)}
    </span>
  );
}

function Detail(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-0.5 text-sm break-words">{props.children}</dd>
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: ProfileUpdate) => unwrap(api.PATCH('/users/me', { body })),
  });
  const built = buildUpdate(profile, draft);
  // Save is offered as soon as anything differs; a wrong value then shows its reason.
  const changed = !built.ok || hasChanges(built.value);
  const set = (patch: Partial<ProfileDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    if (!hasChanges(built.value)) return;
    setErrors({});
    setFormError(null);
    try {
      const updated = await save.mutateAsync(built.value);
      queryClient.setQueryData(queryKeys.me, updated);
      updateUser(updated);
      setDraft(draftOf(updated));
      toast.success('Profile saved.');
    } catch (error) {
      if (error instanceof ApiError && error.isValidation)
        setErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors).map(([k, v]) => [k, v.replace(/^Value error, /, '')]),
          ),
        );
      setFormError((error as Error).message);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="edit-profile"
      className="space-y-4 rounded-xl border bg-card shadow-card p-5"
    >
      <h2 id="edit-profile" className="font-semibold">
        Edit profile
      </h2>
      {formError && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{formError}</span>
        </div>
      )}
      <FormField label="Full name" required error={errors.full_name}>
        {(field) => (
          <Input
            {...field}
            autoComplete="name"
            maxLength={100}
            value={draft.full_name}
            onChange={(e) => set({ full_name: e.target.value })}
          />
        )}
      </FormField>
      <FormField label="Phone number" hint="Optional." error={errors.phone_number}>
        {(field) => (
          <Input
            {...field}
            type="tel"
            autoComplete="tel"
            maxLength={20}
            value={draft.phone_number}
            onChange={(e) => set({ phone_number: e.target.value })}
          />
        )}
      </FormField>
      <FormField
        label="Profile image URL"
        hint="Optional. A link to an image (http:// or https://)."
        error={errors.profile_image_url}
      >
        {(field) => (
          <Input
            {...field}
            type="url"
            autoComplete="off"
            maxLength={500}
            value={draft.profile_image_url}
            onChange={(e) => set({ profile_image_url: e.target.value })}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || !changed}>
          {save.isPending && <Spinner />}
          Save profile
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={() => {
            setDraft(draftOf(profile));
            setErrors({});
            setFormError(null);
          }}
        >
          Reset
        </Button>
      </div>
    </form>
  );
}

/** /app/profile - the logged-in user's account (GET / PATCH /users/me). */
export default function ProfilePage() {
  const { state } = useAuth();
  const profile = state.status === 'authenticated' ? state.user : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 page-title text-3xl">
          <UserRound aria-hidden className="size-5 text-muted-foreground" />
          Profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Your account as the backend stores it. Email, account status and verification can't be
          changed here.
        </p>
      </div>
      {!profile ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <section aria-label="Account details" className="space-y-4 rounded-xl border bg-card shadow-card p-5">
            <div className="flex items-center gap-4">
              <Avatar profile={profile} />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{profile.full_name}</h2>
                <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Email">{profile.email}</Detail>
              <Detail label="Phone number">{profile.phone_number ?? 'Not set'}</Detail>
              <Detail label="Account status">
                <StatusBadge kind="account" value={profile.account_status} />
              </Detail>
              <Detail label="Email verified">{profile.email_verified ? 'Yes' : 'No'}</Detail>
              <Detail label="Last login">
                {profile.last_login_at ? formatDateTime(profile.last_login_at) : 'Never'}
              </Detail>
              <Detail label="Member since">{formatDateTime(profile.created_at)}</Detail>
            </dl>
          </section>
          <ProfileForm key={profile.id} profile={profile} />
        </>
      )}
    </div>
  );
}
