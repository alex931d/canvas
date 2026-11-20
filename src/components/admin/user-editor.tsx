"use client";

import { useActionState, useState } from "react";
import {
  removeUserAvatar,
  saveUser,
  sendResetLink,
  setComplimentary,
  signOutEverywhere,
  type AdminActionState,
} from "@/app/admin/actions";
import { Field, FormError, FormNotice, SubmitButton } from "@/components/auth/form-parts";
import { Button, Input, Select, Switch } from "@/components/kit";
import { ROLES, ROLE_INFO, type Role } from "@/lib/auth/roles";

/** The edit panel's forms. What's allowed comes from the server; the actions check it again. */

export type EditorUser = { id: string; name: string; email: string; role: Role; emailVerified: boolean };

export type EditorPermissions = {
  /** May edit this account at all (support can't edit staff). */
  manage: boolean;
  email: boolean;
  /** Why the role can't be changed here, or null if it can. */
  roleBlocked: string | null;
  comp: boolean;
  self: boolean;
};

export function DetailsForm({ user, perms }: { user: EditorUser; perms: EditorPermissions }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(saveUser, {});
  // Saving changes the account, which remounts the fields with its new values.
  const version = [user.name, user.email, user.role, user.emailVerified].join("|");
  return (
    <form action={action} className="grid gap-4" noValidate aria-label="Account details">
      <input type="hidden" name="id" value={user.id} />
      <FormError message={state.error} />
      <FormNotice message={state.ok} />
      <DetailFields key={version} user={user} perms={perms} state={state} />
      <SubmitButton pending={pending} disabled={!perms.manage}>
        Save changes
      </SubmitButton>
    </form>
  );
}

function DetailFields({ user, perms, state }: { user: EditorUser; perms: EditorPermissions; state: AdminActionState }) {
  const [role, setRole] = useState<Role>(user.role);
  const fe = state.fieldErrors ?? {};
  const locked = !perms.manage;
  return (
    <>
      <Field id="admin-name" label="Name" error={fe.name}>
        <Input
          id="admin-name"
          name="name"
          defaultValue={state.values?.name ?? user.name}
          disabled={locked}
          aria-invalid={!!fe.name || undefined}
        />
      </Field>
      <Field
        id="admin-email"
        label="Email"
        error={fe.email}
        hint={perms.email ? undefined : "Only admins can change email addresses"}
      >
        <Input
          id="admin-email"
          name="email"
          type="email"
          defaultValue={state.values?.email ?? user.email}
          disabled={!perms.email}
          aria-invalid={!!fe.email || undefined}
        />
      </Field>
      <Field id="admin-role" label="Role" hint={perms.roleBlocked ?? ROLE_INFO[role].description}>
        <Select
          id="admin-role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={!!perms.roleBlocked}
          aria-describedby="admin-role-hint"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_INFO[r].label}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-4 rounded-lg border border-beige-500/40 bg-white px-5 py-3.5">
        <span>
          <span className="block text-sm font-bold">Email confirmed</span>
          <span className="block text-xs text-grey-500">Off sends them to enter a code before they can use canvas.</span>
        </span>
        <Switch name="emailVerified" defaultChecked={user.emailVerified} disabled={locked} aria-label="Email confirmed" />
      </label>
    </>
  );
}

/** A one-button form for an action on the account, with its result underneath. */
function ActionButton({
  action,
  fields,
  label,
  disabled,
}: {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  fields: Record<string, string>;
  label: string;
  disabled?: boolean;
}) {
  const [state, run, pending] = useActionState<AdminActionState, FormData>(action, {});
  return (
    <form action={run} className="grid gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant="secondary" size="lg" full loading={pending} disabled={disabled}>
        {label}
      </Button>
      {state.ok ? (
        <p role="status" className="text-sm text-green">
          {state.ok}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function ComplimentaryButton({ userId, give, disabled }: { userId: string; give: boolean; disabled: boolean }) {
  return (
    <ActionButton
      // The same form either way, so "Gave them…" stays on screen once the button turns into "End…".
      action={setComplimentary}
      fields={{ id: userId, give: give ? "1" : "0" }}
      label={give ? "Give complimentary membership" : "End complimentary membership"}
      disabled={disabled}
    />
  );
}

export function SignOutEverywhereButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  return <ActionButton action={signOutEverywhere} fields={{ id: userId }} label="Sign out everywhere" disabled={disabled} />;
}

export function RemoveAvatarButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  return <ActionButton action={removeUserAvatar} fields={{ id: userId }} label="Remove profile picture" disabled={disabled} />;
}

export function SendResetButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  return <ActionButton action={sendResetLink} fields={{ id: userId }} label="Email a password reset link" disabled={disabled} />;
}
