"use client";

import { Camera, Trash2 } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import { deleteAvatar, saveName, uploadAvatar, type NameState } from "@/app/settings/actions";
import { Avatar, Button, Input, Label, toast } from "@/components/kit";
import { AVATAR_SIZE } from "@/lib/profile/avatar";

/**
 * Crop the middle square of a photo and encode it at AVATAR_SIZE (WebP, or
 * JPEG where the browser can't write WebP), so uploads are small and the
 * server never has to resize anything.
 */
async function squarePicture(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // behind transparent pictures (JPEG has no transparency)
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode("image/webp", 0.86);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg", 0.88);
  if (!jpeg) throw new Error("This browser couldn't prepare the picture.");
  return jpeg;
}

export function ProfileSection({
  user,
}: {
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}) {
  const [avatar, setAvatar] = useState(user.avatarUrl);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nameState, submitName, savingName] = useActionState<NameState, FormData>(saveName, {});

  const choose = (file: File | undefined) => {
    if (!file) return;
    startBusy(async () => {
      let blob: Blob;
      try {
        blob = await squarePicture(file);
      } catch {
        toast.error("That file isn't a picture this browser can open. Try a JPEG or PNG.");
        return;
      }
      const local = URL.createObjectURL(blob);
      setPreview(local);
      const form = new FormData();
      form.set("avatar", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      const result = await uploadAvatar(form);
      setPreview(null);
      URL.revokeObjectURL(local);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAvatar(result.avatarUrl);
      toast.success("Profile picture updated.");
    });
  };

  const remove = () =>
    startBusy(async () => {
      const result = await deleteAvatar();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAvatar(null);
      toast.success("Profile picture removed.");
    });

  return (
    <div className="grid gap-8 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @2xl:gap-10">
      <div className="flex flex-wrap items-center gap-5 @2xl:flex-col @2xl:flex-nowrap @2xl:items-start">
        <Avatar
          name={nameState.ok && nameState.value ? nameState.value : user.name}
          src={preview ?? avatar}
          className="size-24 text-3xl ring-4 ring-white @2xl:size-32 @2xl:text-4xl"
        />
        <div className="grid gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-label="Profile picture file"
            data-testid="avatar-input"
            onChange={(e) => {
              choose(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <Button variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>
            {busy ? null : <Camera />}
            {avatar ? "Change picture" : "Add a picture"}
          </Button>
          {avatar ? (
            <Button variant="ghost" disabled={busy} onClick={remove} className="text-red hover:text-red">
              <Trash2 /> Remove picture
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid content-start gap-6">
        <form action={submitName} className="grid gap-2">
          <Label htmlFor="settings-name">Name</Label>
          <div className="flex flex-col gap-2 @md:flex-row">
            <Input
              id="settings-name"
              name="name"
              defaultValue={nameState.value ?? user.name}
              maxLength={80}
              autoComplete="name"
              required
              aria-invalid={nameState.error ? true : undefined}
              aria-describedby="settings-name-note"
            />
            <Button type="submit" size="lg" loading={savingName} className="shrink-0">
              Save name
            </Button>
          </div>
          <p
            id="settings-name-note"
            role={nameState.error ? "alert" : "status"}
            className={nameState.error ? "text-sm text-red" : "text-sm text-grey-500"}
          >
            {nameState.error ?? nameState.ok ?? "Shown to people you share drawings with, next to your cursor."}
          </p>
        </form>
        <div className="grid gap-1 text-sm">
          <span className="text-xs font-bold text-grey-500">Email</span>
          <span className="truncate">{user.email}</span>
        </div>
        <p className="text-sm leading-relaxed text-grey-500">
          Your picture is cropped to the middle square of the photo. People you share a drawing with see it, and so does
          canvas staff.
        </p>
      </div>
    </div>
  );
}
