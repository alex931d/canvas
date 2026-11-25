"use client";

import { Check, Copy, Download } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import {
  beginTwoFactor,
  cancelTwoFactorSetup,
  confirmTwoFactor,
  disableTwoFactor,
  disconnectGoogle,
  emailPasswordLink,
  regenerateRecoveryCodes,
  type CodesState,
  type SimpleState,
} from "@/app/settings/security-actions";
import { Badge, Button, Input, Label, buttonClasses, toast } from "@/components/kit";
import type { SetupDetails } from "@/lib/auth/two-factor";
import { cn } from "@/lib/utils";

/** Settings > Signing in: the password, two-factor sign-in, and Google. */

export type SigningInProps = {
  email: string;
  hasPassword: boolean;
  twoFactor: {
    available: boolean;
    enabled: boolean;
    /** When it was turned on (ISO), if it is. */
    since: string | null;
    recoveryCodesLeft: number;
    /** A setup started earlier and not finished. */
    setup: SetupDetails | null;
  };
  google: {
    enabled: boolean;
    /** The connected Google account's address, or null. */
    linkedEmail: string | null;
    /** What happened on the way back from Google (?google=). */
    result: string | null;
  };
};

const row = "grid gap-4 border-t border-grey-100 pt-6 first:border-t-0 first:pt-0 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @2xl:gap-10";
const rowTitle = "text-base font-bold";
const muted = "text-sm leading-relaxed text-grey-500";

export function SigningInSection(props: SigningInProps) {
  return (
    <div className="grid gap-6">
      <PasswordRow hasPassword={props.hasPassword} />
      <TwoFactorRow {...props.twoFactor} email={props.email} />
      {props.google.enabled ? <GoogleRow {...props.google} hasPassword={props.hasPassword} /> : null}
    </div>
  );
}

// ----------------------------------------------------------------- password

function PasswordRow({ hasPassword }: { hasPassword: boolean }) {
  const [state, run, pending] = useActionState<SimpleState, FormData>(() => emailPasswordLink(), {});
  return (
    <section className={row} aria-labelledby="password-title">
      <div className="grid content-start gap-1">
        <h3 id="password-title" className={rowTitle}>
          Password
        </h3>
        <p className={muted}>{hasPassword ? "Set." : "Not set: you log in with Google."}</p>
      </div>
      <form action={run} className="grid content-start justify-items-start gap-3">
        <p className={muted}>
          {hasPassword
            ? "To change it, we'll email you a link. Changing it signs you out everywhere else."
            : "Add one so you can also log in with your email. We'll email you a link to set it."}
        </p>
        <Button type="submit" variant="secondary" loading={pending}>
          {hasPassword ? "Email me a link to change it" : "Email me a link to set one"}
        </Button>
        <Result state={state} />
      </form>
    </section>
  );
}

// --------------------------------------------------------------- two-factor

function TwoFactorRow({
  available,
  enabled,
  since,
  recoveryCodesLeft,
  setup: initialSetup,
  email,
}: SigningInProps["twoFactor"] & { email: string }) {
  const [setup, setSetup] = useState<SetupDetails | null>(initialSetup);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [starting, startSetup] = useTransition();

  const begin = () =>
    startSetup(async () => {
      const result = await beginTwoFactor();
      if (result.ok) setSetup(result.setup);
      else toast.error(result.error);
    });

  let body: React.ReactNode;
  if (codes) {
    body = <RecoveryCodes codes={codes} email={email} onDone={() => setCodes(null)} />;
  } else if (enabled) {
    body = <TwoFactorOn since={since} left={recoveryCodesLeft} onNewCodes={setCodes} />;
  } else if (setup) {
    body = (
      <SetupSteps
        setup={setup}
        onCancel={() => {
          setSetup(null);
          void cancelTwoFactorSetup();
        }}
        onDone={(recovery) => {
          setSetup(null);
          setCodes(recovery);
        }}
      />
    );
  } else if (!available) {
    body = <p className={muted}>Two-factor sign-in isn&apos;t available on this site yet.</p>;
  } else {
    body = (
      <div className="grid justify-items-start gap-3">
        <p className={muted}>
          Logging in will also need a 6-digit code from an authenticator app on your phone (Google Authenticator,
          1Password, Authy or similar), so your password alone isn&apos;t enough.
        </p>
        <Button variant="secondary" loading={starting} onClick={begin}>
          Set up two-factor sign-in
        </Button>
      </div>
    );
  }

  return (
    <section className={row} aria-labelledby="two-factor-title">
      <div className="grid content-start gap-1">
        <h3 id="two-factor-title" className={cn(rowTitle, "flex items-center gap-2")}>
          Two-factor sign-in
          {enabled || codes ? <Badge tone="green">On</Badge> : null}
        </h3>
        <p className={muted}>An extra code when you log in.</p>
      </div>
      <div className="min-w-0">{body}</div>
    </section>
  );
}

function SetupSteps({
  setup,
  onCancel,
  onDone,
}: {
  setup: SetupDetails;
  onCancel: () => void;
  onDone: (codes: string[]) => void;
}) {
  const [state, run, pending] = useActionState<CodesState, FormData>(async (prev, form) => {
    const result = await confirmTwoFactor(prev, form);
    if (result.recoveryCodes) onDone(result.recoveryCodes);
    return result;
  }, {});
  return (
    <ol className="grid gap-6" aria-label="Set up two-factor sign-in">
      <li className="grid gap-3">
        <p className="text-sm font-bold">1. Add canvas to your authenticator app</p>
        <p className={muted}>Scan this code with the app.</p>
        <div
          className="size-44 overflow-hidden rounded-lg bg-white p-1 ring-1 ring-grey-100 [&>svg]:size-full"
          role="img"
          aria-label="QR code for your authenticator app"
          data-testid="totp-qr"
          // Our own SVG, made on the server from the key (uqr).
          dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
        />
        <p className={muted}>
          On this phone?{" "}
          <a href={setup.uri} className="font-bold text-grey-900 underline underline-offset-4 hover:text-green">
            Open it in your app
          </a>
          . Can&apos;t scan? Type this key in instead:
        </p>
        <code
          className="w-fit max-w-full rounded-md bg-beige-100 px-3 py-2 font-mono text-sm break-all select-all"
          data-testid="totp-key"
        >
          {setup.manualKey}
        </code>
      </li>
      <li>
        <form action={run} className="grid gap-3" noValidate>
          <Label htmlFor="totp-confirm" className="text-sm font-bold">
            2. Enter the code it shows
          </Label>
          <div className="flex flex-col gap-2 @md:flex-row">
            <Input
              id="totp-confirm"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              aria-invalid={state.error ? true : undefined}
              aria-describedby="totp-confirm-note"
              className="tabular-nums @md:max-w-48"
            />
            <Button type="submit" size="lg" loading={pending} className="shrink-0">
              Turn on
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          </div>
          <p id="totp-confirm-note" role={state.error ? "alert" : "status"} className={state.error ? "text-sm text-red" : muted}>
            {state.error ?? "Turning it on signs you out on your other devices."}
          </p>
        </form>
      </li>
    </ol>
  );
}

function RecoveryCodes({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `canvas recovery codes for ${email}\nEach one works once, when you can't use your authenticator app.\n\n${codes.join("\n")}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("This browser didn't allow copying. Select the codes and copy them instead.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "canvas-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="grid gap-4" data-testid="recovery-codes">
      <div className="grid gap-1">
        <p className="text-sm font-bold">Save your recovery codes</p>
        <p className={muted}>
          If you lose your phone, each of these logs you in once instead of a code from the app. Keep them somewhere safe,
          like a password manager. They won&apos;t be shown again.
        </p>
      </div>
      <ul className="grid w-fit grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-beige-100 px-5 py-4 font-mono text-sm select-all">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download /> Download
        </Button>
        <Button onClick={onDone}>I&apos;ve saved them</Button>
      </div>
    </div>
  );
}

function TwoFactorOn({
  since,
  left,
  onNewCodes,
}: {
  since: string | null;
  left: number;
  onNewCodes: (codes: string[]) => void;
}) {
  const [asking, setAsking] = useState<"off" | "codes" | null>(null);
  return (
    <div className="grid gap-4">
      <p className={muted}>
        On{since ? ` since ${new Date(since).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : ""}.{" "}
        <span className={left <= 3 ? "font-bold text-red" : undefined}>
          {left} recovery {left === 1 ? "code" : "codes"} left.
        </span>
      </p>
      {asking ? (
        <ConfirmWithCode
          key={asking}
          kind={asking}
          onCancel={() => setAsking(null)}
          onCodes={(codes) => {
            setAsking(null);
            onNewCodes(codes);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAsking("codes")}>
            Make new recovery codes
          </Button>
          <Button variant="ghost" onClick={() => setAsking("off")} className="text-red hover:text-red">
            Turn off
          </Button>
        </div>
      )}
    </div>
  );
}

/** Turning two-factor off, or new recovery codes: both need a current code first. */
function ConfirmWithCode({
  kind,
  onCancel,
  onCodes,
}: {
  kind: "off" | "codes";
  onCancel: () => void;
  onCodes: (codes: string[]) => void;
}) {
  const [state, run, pending] = useActionState<CodesState, FormData>(async (prev, form) => {
    const result = await (kind === "off" ? disableTwoFactor : regenerateRecoveryCodes)(prev, form);
    if (result.recoveryCodes) onCodes(result.recoveryCodes);
    if (result.ok) toast.success(result.ok);
    return result;
  }, {});
  return (
    <form action={run} className="grid gap-3 rounded-lg border border-grey-100 p-4" noValidate>
      <Label htmlFor="totp-current" className="text-sm font-bold">
        {kind === "off" ? "Enter a code to turn it off" : "Enter a code to make new ones"}
      </Label>
      <div className="flex flex-col gap-2 @md:flex-row">
        <Input
          id="totp-current"
          name="code"
          autoComplete="one-time-code"
          maxLength={16}
          required
          autoFocus
          aria-invalid={state.error ? true : undefined}
          aria-describedby="totp-current-note"
          className="tabular-nums @md:max-w-48"
        />
        <Button type="submit" size="lg" variant={kind === "off" ? "danger" : "primary"} loading={pending} className="shrink-0">
          {kind === "off" ? "Turn off" : "Make new codes"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
      <p id="totp-current-note" role={state.error ? "alert" : "status"} className={state.error ? "text-sm text-red" : muted}>
        {state.error ??
          (kind === "off"
            ? "From your authenticator app, or one of your recovery codes."
            : "From your authenticator app, or a recovery code. Your old recovery codes stop working.")}
      </p>
    </form>
  );
}

// ------------------------------------------------------------------- Google

const GOOGLE_RESULTS: Record<string, { ok: boolean; text: string }> = {
  linked: { ok: true, text: "Google is connected. You can log in with it from now on." },
  already: { ok: true, text: "That Google account was already connected." },
  taken: { ok: false, text: "That Google account is connected to a different canvas account." },
  "has-other": { ok: false, text: "A different Google account is connected. Disconnect it first." },
  cancelled: { ok: false, text: "Connecting Google was cancelled." },
  failed: { ok: false, text: "Connecting Google didn't work. Try again." },
  limited: { ok: false, text: "Too many tries from this network. Wait a minute and try again." },
  off: { ok: false, text: "Google sign-in isn't set up on this site." },
};

function GoogleRow({
  linkedEmail,
  result,
  hasPassword,
}: SigningInProps["google"] & { hasPassword: boolean }) {
  const [state, run, pending] = useActionState<SimpleState, FormData>(() => disconnectGoogle(), {});
  const shown = result ? GOOGLE_RESULTS[result] : undefined;
  return (
    <section className={row} aria-labelledby="google-title">
      <div className="grid content-start gap-1">
        <h3 id="google-title" className={cn(rowTitle, "flex items-center gap-2")}>
          Google
          {linkedEmail ? <Badge tone="green">Connected</Badge> : null}
        </h3>
        <p className={muted}>Log in with your Google account.</p>
      </div>
      <div className="grid content-start justify-items-start gap-3">
        {shown && !state.ok ? (
          <p role={shown.ok ? "status" : "alert"} className={cn("text-sm", shown.ok ? "text-green" : "text-red")}>
            {shown.text}
          </p>
        ) : null}
        {linkedEmail ? (
          <form action={run} className="grid justify-items-start gap-3">
            <p className={muted}>
              Connected to <strong className="font-bold text-grey-900">{linkedEmail}</strong>.
              {hasPassword ? null : " To disconnect it, set a password first, so you can still log in."}
            </p>
            <Button type="submit" variant="secondary" loading={pending} disabled={!hasPassword}>
              Disconnect Google
            </Button>
            <Result state={state} />
          </form>
        ) : (
          <>
            <p className={muted}>Connect it, and Continue with Google on the login page logs you in to this account.</p>
            <a href="/login/google?intent=connect" className={buttonClasses({ variant: "secondary" })}>
              Connect Google
            </a>
            <Result state={state} />
          </>
        )}
      </div>
    </section>
  );
}

function Result({ state }: { state: SimpleState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-red">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-green">
        {state.ok}
      </p>
    );
  }
  return null;
}
