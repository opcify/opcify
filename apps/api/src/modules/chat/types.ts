import { z } from "zod";

export const chatSendBody = z.object({
  message: z.string().max(100_000),
  sessionKey: z.string().min(1).max(100).optional(),
  attachments: z.array(z.object({
    type: z.enum(["image", "file"]),
    mediaType: z.string(),
    fileName: z.string().optional(),
    data: z.string(),
  })).max(5).optional(),
});

export const chatSessionBody = z.object({
  sessionKey: z.string().min(1).max(100).optional(),
});
