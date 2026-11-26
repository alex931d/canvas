import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";

/** A drawing in a grid: its picture, title, a line about it, a chip over the picture, and its ⋯ menu. */
export function DrawingCard({
  index,
  id,
  title,
  thumbnail,
  detail,
  chip,
  accent = "bg-green",
  menu,
}: {
  /** Place in the grid: cards in a row come in one after another. */
  index: number;
  id: string;
  title: string;
  thumbnail: string | null;
  detail: React.ReactNode;
  chip: React.ReactNode;
  accent?: string;
  /** The ⋯ menu (DrawingMenu), placed at the bottom right. */
  menu: React.ReactNode;
}) {
  return (
    <Reveal as="li" delay={(index % 3) * 0.05} className="group relative">
      <Link href={`/drawings/${id}`} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="relative block aspect-[16/10] overflow-hidden rounded-lg bg-beige-100 ring-1 ring-black/5 transition-shadow group-hover:ring-2 group-hover:ring-green/50">
          {thumbnail ? (
            // Small data URLs stored in Postgres; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
          ) : null}
          {chip ? (
            <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-grey-900/85 px-2.5 py-1 text-xs font-semibold text-white">
              {chip}
            </span>
          ) : null}
        </span>
        <span className="mt-3 flex items-center gap-3 pr-10">
          <span className={`h-9 w-1 shrink-0 rounded-full ${accent}`} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-bold">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">{detail}</span>
          </span>
        </span>
      </Link>
      {menu}
    </Reveal>
  );
}
