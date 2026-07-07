// Shared LLM extraction prompt builders for memory fact extraction.
// Used by the LoCoMo eval harness and available for future production
// LLM-based extraction paths.

export type ExtractedFact = {
  subject: string;
  predicate: string;
  objectSummary: string;
};

export type ExtractionPromptOptions = {
  sessionDate?: number;
};

export type ExtractionUserPromptOptions = ExtractionPromptOptions & {
  conversationId: string;
  chunkNum: number;
  totalChunks: number;
};

const BASE_SYSTEM_PROMPT = [
  "You are a memory extraction system. Extract atomic, self-contained facts from the dialogue.",
  "Each fact must be a clear, standalone statement that can be understood WITHOUT the original dialogue context.",
  "",
  "Schema constraints:",
  "- subject: A person's name (e.g., 'Alice', 'John'). Never use pronouns ('I', 'he', 'she', 'they').",
  "- predicate: A short snake_case verb phrase (e.g., 'started_job', 'enjoys_hobby', 'visited_place', 'plan').",
  "- objectSummary: The fact content, including resolved absolute dates. Must be self-contained.",
  "- One fact per atomic piece of information. Split compound sentences into multiple facts.",
  "",
  "Focus on: personal info (name, age, job, family), preferences and interests, events and experiences",
  "(with time references), relationships between people, plans and intentions, opinions and beliefs.",
  "Use the speaker's name as the subject when they reveal something about themselves.",
  "Use third-person perspective (e.g., 'Alice works as a nurse', not 'I work as a nurse').",
  "",
  "Examples of GOOD extraction:",
  '  {"subject": "Alice", "predicate": "occupation", "objectSummary": "works as a registered nurse at City Hospital"}',
  '  {"subject": "John", "predicate": "started_hobby", "objectSummary": "started learning surfing in March 2018"}',
  '  {"subject": "Bob", "predicate": "plan", "objectSummary": "plans to visit Japan in November 2023"}',
  '  {"subject": "Carol", "predicate": "family", "objectSummary": "has a younger sister named Emily"}',
  "",
  "DO NOT extract:",
  "  - Greetings or small talk (e.g., 'Hi, how are you?', 'Nice weather today')",
  "  - Vague statements without specifics (e.g., 'She likes music' — instead extract the specific genre/artist)",
  "  - Meta-commentary about the conversation itself (e.g., 'We talked about hobbies')",
  "  - Future tense without concrete plans (e.g., 'Maybe someday' — not extractable)",
  "",
  'Return ONLY a JSON array. Each element: {"subject": string, "predicate": string, "objectSummary": string}.',
].join("\n");

const TIME_NORMALIZATION_INSTRUCTIONS =
  "IMPORTANT: If the dialogue contains relative time expressions (yesterday, last month, " +
  "three weeks ago, next year, recently), resolve them to absolute dates using the session date provided. " +
  "Embed the resolved absolute date directly in the objectSummary field. " +
  'Example: session date 8 May 2023, input "went to the beach yesterday" → ' +
  'objectSummary: "went to the beach on 7 May 2023".';

export function buildExtractionSystemPrompt(
  options?: ExtractionPromptOptions,
): string {
  let prompt = BASE_SYSTEM_PROMPT;
  if (options?.sessionDate !== undefined) {
    prompt += "\n\n" + TIME_NORMALIZATION_INSTRUCTIONS;
  }
  return prompt;
}

export function buildExtractionUserPrompt(
  dialogue: string,
  options: ExtractionUserPromptOptions,
): string {
  const { conversationId, chunkNum, totalChunks, sessionDate } = options;
  let prompt =
    `Extract facts from this dialogue (part ${chunkNum}/${totalChunks} of conversation ${conversationId}):\n\n` +
    `${dialogue}\n\n`;

  if (sessionDate !== undefined) {
    const dateStr = new Date(sessionDate).toISOString().split("T")[0];
    prompt += `This dialogue occurred on ${dateStr}. Resolve any relative time references to absolute dates using this date.\n\n`;
  }

  prompt += "Return ONLY a JSON array of fact objects, no other text.";
  return prompt;
}

export function parseExtractionResponse(content: string): ExtractedFact[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ExtractedFact =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ExtractedFact).subject === "string" &&
        typeof (item as ExtractedFact).predicate === "string" &&
        typeof (item as ExtractedFact).objectSummary === "string",
    );
  } catch {
    return [];
  }
}
