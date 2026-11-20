"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { createDrawing } from "@/app/actions";
import { Button } from "@/components/kit";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" loading={pending} className="px-5">
      {pending ? null : <Plus />}
      {pending ? "Opening…" : label}
    </Button>
  );
}

export function NewDrawingButton({ label = "New Drawing" }: { label?: string }) {
  return (
    <form action={createDrawing}>
      <Submit label={label} />
    </form>
  );
}
