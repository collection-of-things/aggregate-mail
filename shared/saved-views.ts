import { z } from "zod";

export const savedViewNameSchema = z.string().trim().min(1).max(80)
  .refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
export const savedViewDefinitionSchema = z.object({
  view: z.enum(["inbox", "snoozed", "archive", "sent", "all", "drafts"]),
  tab: z.enum(["primary", "social", "promotions", "newsletters", "transactions", "updates"]),
  query: z.string().max(4000),
  accountFilter: z.string().min(1).max(200),
  labelFilter: z.string().min(1).max(500),
  readFilter: z.enum(["all", "unread"]),
  relevanceFilter: z.enum(["all", "1", "2", "3"]),
  sort: z.enum(["newest", "oldest", "relevance"]),
}).strict();
export const savedViewSchema = z.object({
  id: z.string().uuid(), name: savedViewNameSchema,
  definition: savedViewDefinitionSchema, revision: z.number().int().positive(),
}).strict();
export type SavedViewDefinition = z.infer<typeof savedViewDefinitionSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;
