"use client";

import { Check, ChevronDown, Copy, Link2, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Switch,
  toast,
} from "@/components/kit";
import {
  getSharing,
  leaveDrawing,
  removeMember,
  resetShareLink,
  setLinkSharing,
  setMemberRole,
  type SharingResult,
  type SharingState,
} from "@/app/sharing-actions";
import type { MemberRole } from "@/db/schema";
import { peerColor } from "@/lib/collab/peers";

const ROLE_LABEL: Record<MemberRole, string> = { editor: "Can edit", viewer: "Can view" };

/**
 * Sharing for one drawing. The owner turns on an invite link (anyone with a
 * membership who opens it joins, with the link's role) and manages people;
 * collaborators see who has access and can leave.
 */
export function ShareDialog({
  drawingId,
  title,
  me,
  open,
  onOpenChange,
}: {
  drawingId: string;
  title: string;
  me: { id: string; name: string; avatarUrl?: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<SharingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const apply = (res: SharingResult) => {
    if (res.ok) {
      setState(res.state);
      setError(null);
    } else {
      setError(res.error);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSharing(drawingId).then(
      (res) => !cancelled && apply(res),
      () => !cancelled && setError("Couldn't load sharing. Check your connection."),
    );
    return () => {
      cancelled = true;
    };
  }, [open, drawingId]);

  const run = (action: () => Promise<SharingResult>) =>
    start(async () => {
      try {
        apply(await action());
      } catch {
        setError("Couldn't save that. Check your connection and try again.");
      }
    });

  const link = state?.role === "owner" && state.link.token ? `${window.location.origin}/join/${state.link.token}` : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-6"
        title={`Share “${title}”`}
        description="People you share with draw on the same canvas and see each other's changes and cursors live. Only people with a membership can open it."
      >
        {error ? (
          <p role="alert" className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            {error}
          </p>
        ) : null}

        {!state ? (
          <div className="flex justify-center py-6">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : state.role === "owner" ? (
          <>
            <section className="flex flex-col gap-3 rounded-xl bg-beige-100 p-4">
              <label className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <Link2 className="size-4" /> Invite with a link
                </span>
                <Switch
                  checked={!!state.link.token}
                  disabled={pending}
                  onCheckedChange={(on) => run(() => setLinkSharing(drawingId, on, state.link.role))}
                  aria-label="Invite with a link"
                />
              </label>
              {link ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      fieldSize="sm"
                      value={link}
                      aria-label="Invite link"
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-10 flex-1 font-mono text-xs"
                    />
                    <Button onClick={copy} className="h-10" aria-label="Copy link">
                      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      People who join
                      <RolePicker
                        value={state.link.role}
                        disabled={pending}
                        onChange={(role) => run(() => setLinkSharing(drawingId, true, role))}
                      />
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => resetShareLink(drawingId))}
                      title="The old link stops working"
                    >
                      <RefreshCw /> New link
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Turn this on to get a link. People who already joined keep their access when it&apos;s off.
                </p>
              )}
            </section>

            <section className="flex flex-col gap-1">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
                <Users className="size-4" /> People with access
              </h3>
              <PersonRow
                name={me.name}
                id={me.id}
                avatarUrl={me.avatarUrl}
                detail="You"
                right={<span className="text-sm text-muted-foreground">Owner</span>}
              />
              {state.members.map((m) => (
                <PersonRow
                  key={m.userId}
                  id={m.userId}
                  name={m.name}
                  avatarUrl={m.avatarUrl}
                  detail={m.email ?? undefined}
                  right={
                    <Menu>
                      <MenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          aria-label={`${m.name}: ${ROLE_LABEL[m.role]}`}
                        >
                          {ROLE_LABEL[m.role]} <ChevronDown />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem onSelect={() => run(() => setMemberRole(drawingId, m.userId, "editor"))}>
                          Can edit
                        </MenuItem>
                        <MenuItem onSelect={() => run(() => setMemberRole(drawingId, m.userId, "viewer"))}>
                          Can view
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem tone="danger" onSelect={() => run(() => removeMember(drawingId, m.userId))}>
                          Remove
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  }
                />
              ))}
              {state.members.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Nobody else yet. Send someone the link.</p>
              ) : null}
            </section>
          </>
        ) : (
          <>
            <p className="text-sm">
              {state.ownerName ?? "Someone"} shared this with you. You{" "}
              {state.role === "editor" ? "can draw and edit" : "can view it and follow along"}.
            </p>
            <section className="flex flex-col gap-1">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
                <Users className="size-4" /> People with access
              </h3>
              <PersonRow
                id={state.ownerId ?? "owner"}
                name={state.ownerName ?? "Owner"}
                avatarUrl={state.ownerAvatarUrl}
                right={<span className="text-sm text-muted-foreground">Owner</span>}
              />
              {state.members.map((m) => (
                <PersonRow
                  key={m.userId}
                  id={m.userId}
                  name={m.name}
                  avatarUrl={m.avatarUrl}
                  detail={m.userId === me.id ? "You" : undefined}
                  right={<span className="text-sm text-muted-foreground">{ROLE_LABEL[m.role]}</span>}
                />
              ))}
            </section>
            <form action={leaveDrawing.bind(null, drawingId)} className="flex justify-end">
              <Button type="submit" variant="secondary" className="text-red">
                Leave drawing
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RolePicker({
  value,
  disabled,
  onChange,
}: {
  value: MemberRole;
  disabled: boolean;
  onChange: (role: MemberRole) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled} aria-label={`Link role: ${ROLE_LABEL[value]}`}>
          {ROLE_LABEL[value].toLowerCase()} <ChevronDown />
        </Button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem onSelect={() => onChange("editor")}>Can edit</MenuItem>
        <MenuItem onSelect={() => onChange("viewer")}>Can view</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function PersonRow({
  id,
  name,
  avatarUrl,
  detail,
  right,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
  detail?: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-grey-100 py-2 last:border-0">
      <Avatar name={name} src={avatarUrl} className="size-8 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: peerColor(id) }} />
          {name}
        </p>
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      {right}
    </div>
  );
}
