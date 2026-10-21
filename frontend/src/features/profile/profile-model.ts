import type { components } from '@/api/schema';

export type Profile = components['schemas']['UserProfileResponse'];
export type ProfileUpdate = components['schemas']['UpdateProfileRequest'];

/** The fields PATCH /users/me accepts. Email, status and verification are read-only. */
export interface ProfileDraft {
  full_name: string;
  phone_number: string;
  profile_image_url: string;
}

export const draftOf = (p: Profile): ProfileDraft => ({
  full_name: p.full_name,
  phone_number: p.phone_number ?? '',
  profile_image_url: p.profile_image_url ?? '',
});

type Built = { ok: true; value: ProfileUpdate } | { ok: false; errors: Record<string, string> };

/**
 * Only the changed fields are sent. An emptied phone number or image URL is sent
 * as "" (the backend clears it). Same limits as UpdateProfileRequest.
 */
export function buildUpdate(profile: Profile, draft: ProfileDraft): Built {
  const errors: Record<string, string> = {};
  const name = draft.full_name.trim();
  const phone = draft.phone_number.trim();
  const image = draft.profile_image_url.trim();
  if (name.length < 2) errors.full_name = 'At least 2 characters.';
  else if (name.length > 100) errors.full_name = 'At most 100 characters.';
  if (phone.length > 20) errors.phone_number = 'At most 20 characters.';
  else if (phone && !/^[0-9+\-() ]+$/.test(phone))
    errors.phone_number = 'Digits, spaces and + - ( ) only.';
  if (image.length > 500) errors.profile_image_url = 'At most 500 characters.';
  else if (image && !/^https?:\/\//i.test(image))
    errors.profile_image_url = 'Must start with http:// or https://.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const value: ProfileUpdate = {};
  if (name !== profile.full_name) value.full_name = name;
  if (phone !== (profile.phone_number ?? '')) value.phone_number = phone;
  if (image !== (profile.profile_image_url ?? '')) value.profile_image_url = image;
  return { ok: true, value };
}

export const hasChanges = (update: ProfileUpdate) => Object.keys(update).length > 0;
