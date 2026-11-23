"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { createDrawing } from "@/app/actions";
import { Button } from "@/components/kit";

function Submit({ label }: { label: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" loading={pending} className="shrink-0 px-5">
      {pending ? null : <Plus />}
      {pending ? "Opening…" : label}
    </Button>
  );
}

/** Without a label: "New Drawing", just "New" on the narrowest phones (read out in full). */
export function NewDrawingButton({ label }: { label?: string }) {
  return (
    <form action={createDrawing}>
      <Submit
        label={
          label ?? (
            // One flex item, so the button's gap doesn't add a second space.
            <span>
              New<span className="max-[399px]:sr-only"> Drawing</span>
            </span>
          )
        }
      />
    </form>
  );
}
