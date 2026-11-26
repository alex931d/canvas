"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { createWorkspace, type CreateWorkspaceState } from "@/app/workspace-actions";
import { Button, Input } from "@/components/kit";

/** Name a new workspace; making it opens it. */
export function NewWorkspaceForm() {
  const [state, action, pending] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {});
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <label htmlFor="workspace-name" className="text-sm font-bold">
        New workspace
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="workspace-name"
          name="name"
          required
          maxLength={60}
          defaultValue={state.name}
          placeholder="Biology 101, Thursday study group…"
          aria-invalid={!!state.error}
          aria-describedby={state.error ? "workspace-name-error" : undefined}
          className="flex-1"
        />
        <Button type="submit" size="lg" loading={pending} className="h-11 shrink-0">
          {pending ? null : <Plus />} Create workspace
        </Button>
      </div>
      {state.error ? (
        <p id="workspace-name-error" role="alert" className="text-sm text-red">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
