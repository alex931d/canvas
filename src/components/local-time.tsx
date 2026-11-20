"use client";

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Formats a timestamp in the viewer's own locale and time zone. */
export function LocalTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatter.format(new Date(iso))}
    </time>
  );
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** A date (no time) in the viewer's own locale and time zone. */
export function LocalDate({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {dateFormatter.format(new Date(iso))}
    </time>
  );
}
