/**
 * Who may do what with a drawing (checked on the server in ./access.ts):
 *   owner   everything, including sharing and deleting
 *   editor  draw, edit and rename
 *   viewer  look, follow along live, make flashcards from it
 */
export type Role = "owner" | "editor" | "viewer";
