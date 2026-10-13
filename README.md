# live-tutor

## Local development

Install locked dependencies with `npm ci`, then run `npm run dev`.
Open the local URL printed by Vite. Set `GEMINI_LIVE_API` in `.env` for live sessions.
Use `npm run typecheck` to check TypeScript.

## Microphone activity detection

`shared/live.ts` configures both the Worker-issued token and the browser session.
Automatic Gemini VAD uses low start sensitivity and `prefixPaddingMs: 250` to
reduce brief noise triggers. End sensitivity remains low with an 800 ms silence
duration to allow pauses while speaking. Browser noise suppression, echo
cancellation, and automatic gain control remain enabled.

Audio streams directly from the browser to Gemini; the Worker only issues tokens.
These VAD settings do not add audio processing to the Worker's CPU budget.

Check tuning on the intended microphone: typing/clicking without speech should
not trigger a turn; speaking while typing should remain intelligible; quiet or
short utterances should still be recognized. Low sensitivity and padding can
miss short speech, so 250 ms is a starting point rather than a measured optimum.

## Conversation prompts

`worker/prompts.ts` contains a shared conversation policy and a separate flow for
each mode. `src/gemini/live-session.ts` starts the selected flow without forcing
every mode to open with a greeting and question.

The policy separates role, spoken style, response priorities, language support,
boundaries, and illustrative exchanges. Learner requests take priority over the
next practice prompt. Examples demonstrate different response moves rather than
fixed dialogue or default topics.
Phrase, translation, and definition help ends the tutor's turn without an
appended question or an automatic return to the previous topic.

- **Free talk:** develop details and exchange perspectives; change angle when
  a branch is finished or repetitive, not on a fixed turn count.
- **Rapid-fire:** vary short speaking tasks; pause for questions or language help.
- **Role-play:** establish roles, a goal, and a constraint; track agreements and
  close when the goal is met or the learner asks to finish.

Fluency practice does not interrupt every understandable mistake. Brief language
help and specific feedback remain available on request. There is no persistent
cross-session topic history or proficiency/pronunciation scoring.

Prompt changes apply to newly issued session tokens. End the current session
and start again to try a new prompt; an existing Gemini connection keeps its
original system instruction.

Check behavior with a real session: give a concrete story detail, ask the tutor
an opinion, request an English phrase, decline a topic, and close an agreed
role-play. Look for relevant responses, direct help, topic changes, and closure
without reopening the task. Scripted text input with real Gemini audio output
can check dialogue policy, but does not replace microphone testing or establish
long-session consistency.

### Prompt design references

- [Google: Live API best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices)
  — persona, conversational rules, guardrails, and one-time versus loop behavior.
- [Google: Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
  — clear constraints, diverse few-shot examples, and prompt iteration.
- [OpenAI: Realtime Prompting Guide](https://cookbook.openai.com/examples/realtime_prompting_guide)
  — labeled sections, variety, and conversation flow; archived, model-specific
  guidance used as a design reference rather than a Gemini guarantee.
- [Anthropic: Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
  — explicit instructions and relevant, diverse examples; likewise requires
  evaluation on the actual Gemini model.