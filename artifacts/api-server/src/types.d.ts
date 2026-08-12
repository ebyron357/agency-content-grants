// Extend express-session's SessionData to include our userId field.
// The top-level import makes this file a module so `declare module` below
// AUGMENTS express-session instead of replacing its type declarations.
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    isAdmin?: boolean;
  }
}
