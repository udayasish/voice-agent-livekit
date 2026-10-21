import { z } from "zod";

export const languageSchema = z.enum(["as", "hi", "en"]);
export type AgentLanguage = z.infer<typeof languageSchema>;
const spokenText = z.string().trim().min(1).max(4000);
export const agentConfigSchema = z.object({
  agentId: z.string().trim().min(1),
  name: spokenText,
  businessName: spokenText,
  instructions: spokenText,
  languages: z.array(languageSchema).min(1),
  defaultLanguage: languageSchema.default("as"),
  enabledTools: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u)).default([]),
  contextLimits: z.object({ targetBytes: z.number().int().min(1024).max(12288).default(8192),
    hardBytes: z.number().int().min(1024).max(12288).default(12288), inputTokens: z.number().int().min(256).max(3500).default(3500),
    contextWindowTokens: z.number().int().min(1024).optional() }).strict()
    .refine(v => v.targetBytes <= v.hardBytes).default({ targetBytes: 8192, hardBytes: 12288, inputTokens: 3500 }),
  greeting: spokenText.optional(),
  modelSettings: z.object({
    model: z.string().trim().min(1).optional(),
    temperature: z.number().min(0).max(2).default(0.3),
    maxTokens: z.number().int().positive().max(4096).default(256),
  }).default({ temperature: 0.3, maxTokens: 256 }),
  recoveryMessages: z.object({
    as: spokenText.default("ক্ষমা কৰিব, মই সহায় কৰিবলৈ আছোঁ। অনুগ্ৰহ কৰি আকৌ এবাৰ ক'ব পাৰিবনে?"),
    hi: spokenText.default("क्षमा करें, कृपया एक बार फिर बताएं कि मैं आपकी कैसे सहायता कर सकता हूँ?"),
    en: spokenText.default("Sorry, could you please tell me again how I can help?"),
  }).default({
    as: "ক্ষমা কৰিব, মই সহায় কৰিবলৈ আছোঁ। অনুগ্ৰহ কৰি আকৌ এবাৰ ক'ব পাৰিবনে?",
    hi: "क्षमा करें, कृपया एक बार फिर बताएं कि मैं आपकी कैसे सहायता कर सकता हूँ?",
    en: "Sorry, could you please tell me again how I can help?",
  }),
}).strict().refine(c => c.languages.includes(c.defaultLanguage), {
  message: "Default language must be supported", path: ["defaultLanguage"],
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export const sessionContextSchema = z.object({
  organizationId: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
}).strict();
export type SessionContext = z.infer<typeof sessionContextSchema>;
