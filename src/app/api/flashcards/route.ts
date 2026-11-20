import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { drawings, flashcards } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { limiters } from "@/lib/auth/rate-limit";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { getRole } from "@/lib/collab/access";

/**
 * Make a flashcard (multipart form): front, back, optional picture of part
 * of a drawing (image + imageSide + width + height), and the drawing it
 * came from (its title becomes the deck name). Viewers of a shared drawing
 * can make cards from it too: the cards are theirs.
 */

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CARDS = 5000;

const fieldsSchema = z.object({
  front: z.string().trim().max(2000),
  back: z.string().trim().max(2000),
  drawingId: z.uuid().optional(),
  deck: z.string().trim().min(1).max(120).optional(),
  imageSide: z.enum(["front", "back"]).optional(),
  width: z.coerce.number().int().min(1).max(4000).optional(),
  height: z.coerce.number().int().min(1).max(4000).optional(),
});

export async function POST(request: Request) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to make flashcards." }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Flashcards");
  if (notMember) return notMember;
  if (!limiters.flashcardsByUser.consume(user.id)) {
    return Response.json({ error: "That's a lot of cards at once. Try again in a moment." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const fields = fieldsSchema.safeParse({
    front: text("front") ?? "",
    back: text("back") ?? "",
    drawingId: text("drawingId"),
    deck: text("deck"),
    imageSide: text("imageSide"),
    width: text("width"),
    height: text("height"),
  });
  if (!fields.success) return Response.json({ error: "Check the card's fields." }, { status: 422 });
  const f = fields.data;

  const file = form.get("image");
  let image: Buffer | null = null;
  let mime: string | null = null;
  if (file instanceof Blob && file.size > 0) {
    if (!["image/webp", "image/png", "image/jpeg"].includes(file.type)) {
      return Response.json({ error: "The picture must be WebP, PNG or JPEG." }, { status: 415 });
    }
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "The picture is larger than 2 MB." }, { status: 413 });
    if (!f.imageSide || !f.width || !f.height) return Response.json({ error: "Say which side the picture goes on." }, { status: 422 });
    image = Buffer.from(await file.arrayBuffer());
    mime = file.type;
  }

  const frontFilled = !!f.front || (image && f.imageSide === "front");
  const backFilled = !!f.back || (image && f.imageSide === "back");
  if (!frontFilled || !backFilled) {
    return Response.json({ error: "Put something on both sides of the card." }, { status: 422 });
  }

  let deck = f.deck ?? "Cards";
  if (f.drawingId) {
    if (!(await getRole(f.drawingId, user.id))) return Response.json({ error: "Drawing not found." }, { status: 404 });
    const [d] = await db.select({ title: drawings.title }).from(drawings).where(eq(drawings.id, f.drawingId));
    if (d) deck = d.title;
  }

  const [{ n }] = await db.select({ n: count() }).from(flashcards).where(eq(flashcards.userId, user.id));
  if (n >= MAX_CARDS) {
    return Response.json({ error: `You have ${MAX_CARDS} cards, the most there can be. Delete some first.` }, { status: 409 });
  }

  const [card] = await db
    .insert(flashcards)
    .values({
      userId: user.id,
      drawingId: f.drawingId ?? null,
      deck,
      front: f.front,
      back: f.back,
      image,
      imageMimeType: mime,
      imageSide: image ? f.imageSide : null,
      imageWidth: image ? f.width : null,
      imageHeight: image ? f.height : null,
    })
    .returning({ id: flashcards.id, deck: flashcards.deck });
  return Response.json({ ok: true, id: card.id, deck: card.deck }, { status: 201 });
}
