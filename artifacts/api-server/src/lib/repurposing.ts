/**
 * Repurposing Engine — channel catalog and prompt construction.
 *
 * Pure, DB-free functions so channel metadata and prompt assembly can be
 * unit-tested without touching the database or an AI provider. The DB- and
 * AI-touching orchestration lives in `lib/workflows/repurposing-workflow.ts`.
 */
import type { ChatMessage } from "./ai/types";

export interface ChannelMeta {
  label: string;
  platform: string;
  defaultLength: string;
  guidance: string;
}

export const REPURPOSE_CHANNELS: Record<string, ChannelMeta> = {
  linkedin_post: {
    label: "LinkedIn Post",
    platform: "LinkedIn",
    defaultLength: "150-300 words",
    guidance: "Professional but human tone. Strong hook in the first line (no 'I'm excited to announce'). Short paragraphs, no more than one emoji. End with a genuine question or a clear takeaway, not a generic CTA.",
  },
  twitter_thread: {
    label: "X/Twitter Thread",
    platform: "X (Twitter)",
    defaultLength: "5-8 tweets, each under 280 characters",
    guidance: "Punchy hook tweet. Each subsequent tweet makes one point. Number them (1/, 2/, ...). No hashtags spam — at most one relevant hashtag on the final tweet.",
  },
  instagram_caption: {
    label: "Instagram Caption",
    platform: "Instagram",
    defaultLength: "50-150 words",
    guidance: "Conversational, visual language since it pairs with an image/carousel. Line breaks for readability. 3-5 relevant hashtags at the end, separated from the caption body.",
  },
  facebook_post: {
    label: "Facebook Post",
    platform: "Facebook",
    defaultLength: "80-200 words",
    guidance: "Warm, direct, slightly more casual than LinkedIn. Lead with the value to the reader. Avoid jargon.",
  },
  email_newsletter: {
    label: "Email Newsletter Blurb",
    platform: "Email",
    defaultLength: "120-250 words",
    guidance: "Include a compelling subject line on its own first line prefixed 'Subject: '. Then a short, scannable body with one clear call to action.",
  },
  short_video_script: {
    label: "Short-Form Video Script (Reels/TikTok/Shorts)",
    platform: "Short-form video",
    defaultLength: "45-60 seconds spoken (roughly 120-160 words)",
    guidance: "Write as a spoken script with a HOOK (first 2 seconds), then 2-3 beats, then a closing line. Label sections [HOOK], [BEAT], [CLOSE]. Conversational spoken language, not written prose.",
  },
  youtube_description: {
    label: "YouTube Video Description",
    platform: "YouTube",
    defaultLength: "100-200 words",
    guidance: "First 2 lines must work as a standalone hook (shown before 'more'). Include a brief summary and one clear call to action. No excessive hashtags.",
  },
};

export function isValidChannel(channel: string): boolean {
  return channel in REPURPOSE_CHANNELS;
}

export function listChannels(): Array<{ key: string } & ChannelMeta> {
  return Object.entries(REPURPOSE_CHANNELS).map(([key, meta]) => ({ key, ...meta }));
}

export interface RepurposeGenerationInput {
  channel: string;
  sourceTitle: string;
  sourceContent: string;
  brandName?: string;
  brandVoice?: string;
  tone?: string | null;
  audience?: string | null;
  cta?: string | null;
  targetLength?: string | null;
  additionalInstructions?: string | null;
  brainBlock?: string;
  prohibitedVocabulary?: string | null;
  complianceNotes?: string | null;
  previousContent?: string | null;
  regenerationNote?: string | null;
}

/** Build the chat prompt for generating one channel's derivative asset. Pure — no I/O. */
export function buildRepurposePrompt(input: RepurposeGenerationInput): ChatMessage[] {
  const meta = REPURPOSE_CHANNELS[input.channel];
  if (!meta) throw new Error(`Unknown channel: ${input.channel}`);

  const system: ChatMessage = {
    role: "system",
    content: `You are a professional content repurposing specialist. You turn long-form content into platform-native derivative assets that read as if they were written natively for that platform — never as an obvious summary of a blog post. Avoid corporate filler, avoid restating "as mentioned in our article", and never wrap the output in quotes or markdown code fences.

Brand: ${input.brandName ?? ""}
Brand voice: ${input.brandVoice ?? "Professional, clear, and helpful"}${input.prohibitedVocabulary ? `\nProhibited vocabulary — never use any of these terms: ${input.prohibitedVocabulary}` : ""}${input.complianceNotes ? `\nCompliance requirements — must follow: ${input.complianceNotes}` : ""}${input.brainBlock ? `\n\n${input.brainBlock}` : ""}`,
  };

  const user: ChatMessage = {
    role: "user",
    content: `Repurpose the following source content into a ${meta.label} for ${meta.platform}.

Target length: ${input.targetLength || meta.defaultLength}
Tone: ${input.tone || "Match the brand voice"}
Audience: ${input.audience || "Same as the source content's intended audience"}
${input.cta ? `Call to action to include: ${input.cta}` : ""}
Format guidance: ${meta.guidance}
${input.additionalInstructions ? `Additional instructions: ${input.additionalInstructions}` : ""}
${input.previousContent ? `\nA previous version existed. ${input.regenerationNote || "Produce a meaningfully different, improved take — do not just lightly reword the previous version."}\nPrevious version:\n---\n${input.previousContent}\n---\n` : ""}

Source title: ${input.sourceTitle}
Source content:
---
${input.sourceContent.slice(0, 6000)}
---

Return ONLY the ${meta.label} content itself — no preamble, no meta-commentary, no explanation of what you did.`,
  };

  return [system, user];
}
