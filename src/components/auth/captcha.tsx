"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CAPTCHA_FIELD, type CaptchaAction, type CaptchaSite } from "@/lib/auth/captcha-shared";

/*
 * The Cloudflare Turnstile widget for a form (see src/lib/auth/captcha.ts).
 *
 * It runs as soon as the form shows and usually finishes without anyone
 * noticing; it only appears if Cloudflare wants a click. The form stays
 * usable meanwhile: submitting before the check is done waits for it and
 * then sends the form by itself. Tokens work once, so each submission asks
 * the widget for a fresh one for the next try.
 */

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const loading = new Map<string, Promise<Turnstile>>();

function loadTurnstile(src: string): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<Turnstile>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing")));
      script.onerror = () => {
        loading.delete(src); // let a later form try again
        script.remove();
        reject(new Error("Turnstile didn't load"));
      };
      document.head.appendChild(script);
    });
    loading.set(src, promise);
  }
  return promise;
}

const LOAD_FAILED =
  "The check that you're human couldn't load. Check your connection, or allow challenges.cloudflare.com if you block scripts, then reload the page.";

/**
 * `site`: from the page (null = CAPTCHA off, "loading" = not known yet).
 * Spread `formProps` onto the <form>, put `field` inside it, and show
 * `waiting` on the submit button.
 */
export function useCaptcha(site: CaptchaSite | "loading", action: CaptchaAction) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const queued = useRef(false);
  const [token, setToken] = useState("");
  const [usedToken, setUsedToken] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteKey = site && site !== "loading" ? site.siteKey : null;
  const scriptUrl = site && site !== "loading" ? site.scriptUrl : null;

  useEffect(() => {
    const container = box.current;
    if (!siteKey || !scriptUrl || !container) return;
    let cancelled = false;
    const failed = () => {
      queued.current = false;
      setWaiting(false);
      setToken("");
      setError(LOAD_FAILED);
    };
    loadTurnstile(scriptUrl).then((turnstile) => {
      if (cancelled) return;
      widgetId.current =
        turnstile.render(container, {
          sitekey: siteKey,
          action,
          theme: "light",
          size: "flexible",
          appearance: "interaction-only",
          "response-field": false,
          callback: (newToken: string) => {
            flushSync(() => {
              setToken(newToken);
              setError(null);
            });
            if (queued.current) {
              // They pressed submit while the check ran: send it now.
              queued.current = false;
              setWaiting(false);
              container.closest("form")?.requestSubmit();
            }
          },
          "expired-callback": () => setToken(""),
          "timeout-callback": () => setToken(""),
          "error-callback": () => {
            failed();
            return true; // handled here; Turnstile keeps retrying on its own
          },
        }) ?? null;
    }, failed);
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, scriptUrl, action]);

  const ready = site === null || (token !== "" && token !== usedToken);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (site === null) return;
    if (ready) {
      // This token is spent once the server checks it; start on the next one.
      setUsedToken(token);
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
      return;
    }
    event.preventDefault();
    if (!error) {
      queued.current = true;
      setWaiting(true);
    }
  }

  const field =
    site === null ? null : (
      <div className="grid gap-2">
        <div ref={box} data-testid="captcha" />
        {siteKey ? <input type="hidden" name={CAPTCHA_FIELD} value={token} /> : null}
        {error ? (
          <p role="status" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );

  return { formProps: { onSubmit }, field, waiting, ready };
}
