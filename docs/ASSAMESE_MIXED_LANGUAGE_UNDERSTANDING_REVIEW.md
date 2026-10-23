# Assamese Mixed-Language Understanding Review

**Review date:** 24 October 2026  
**Goal:** A caller can mix Assamese, English and Hindi naturally without selecting a language.

## Simple answer

Yes, the agent should understand all of these as the same value:

```text
ছাব্বিছ অক্টোবৰ
twenty-six October
छब्बीस अक्टूबर
26 October
```

The caller should not choose a language before saying a date, time or age.

But this needs two successful steps:

1. **STT must hear the audio correctly enough.**
2. **The booking system must turn the transcript into one safe value.**

The LLM only receives text. It cannot always repair a word that STT heard incorrectly.

## Current behaviour

- The normal STT stream uses Deepgram Nova-3 with Assamese (`language=as`).
- Phone digits temporarily use English India (`en-IN`).
- The agent normally keeps replying in Assamese. Saying an English number should not change the reply language.
- Code supports Assamese, English and Hindi scripts for some numbers, dates and times.
- An intake LLM handles expressions that the fixed parser does not understand.

Examples verified directly against the current code:

| Spoken/transcribed text | Current result |
|---|---|
| `twenty eight` / `আঠাইশ` / `अट्ठाईस` | Age 28 |
| `twenty six October` / `ছাব্বিছ অক্টোবৰ` / `छब्बीस अक्टूबर` | 26 October |
| `nine thirty` / `ন ত্ৰিশ` / `नौ तीस` | 09:30 or 21:30; asks AM/PM |
| `athais`, `চৌষষ্ঠি`, `चौंसठ`, `64.` | Not reliably parsed |
| `subbis October` | Not safely resolved |

This means the basic idea works, but the coverage is incomplete.

## Important provider limitation

Deepgram Nova-3 supports Assamese as a separate monolingual language. Its current multilingual mode supports English and Hindi, but its published multilingual list does **not** include Assamese.

Therefore, changing the current stream to `language=multi` is not a safe production solution for Assamese code-switching. The earlier experiment was correctly disabled.

Automatic language identification also does not fully solve this problem. Some providers can identify the main language of an utterance, but mixed words inside one sentence may still be missed. What we need is **automatic value understanding**, not only a language label.

## Best approach

```text
Audio
  ↓
Primary Assamese STT
  ↓
One transcript with confidence/evidence
  ↓
Multilingual number/date/time normalizer
  ↓ if still unclear
One structured LLM interpretation
  ↓
Validate against the current booking step and real options
  ↓
Save the value or ask one short clarification
```

### 1. Keep Assamese as the normal STT language

This protects the platform's main language. Do not switch the whole conversation because the caller says “twenty-six” or “nine thirty”.

### 2. Build one complete value normalizer

It should accept:

- Assamese, Devanagari and ASCII digits.
- Full Assamese, Hindi and English age numbers from 0 to 120.
- Dates, weekdays, relative dates and month names in all three languages.
- Times such as 9:30, nine thirty, ন ত্ৰিশ and नौ तीस.
- Common STT script changes, such as an English word written in Assamese script.

This should use proper number rules and a reviewed vocabulary. It should not grow as a list of one-off mistakes from individual calls.

### 3. Use the LLM only as a structured fallback

When the normalizer cannot decide, call the LLM once and require data like:

```json
{
  "kind": "date",
  "value": "2026-10-26",
  "evidence": "ছাব্বিছ অক্টোবৰ"
}
```

The LLM identifies meaning. It does not select the next booking step and does not write the final transactional reply.

### 4. Validate every result

- A date must be one of the real offered dates.
- A time must map to one real offered slot.
- An age must be a whole number from 0 to 120.
- Conflicting values must cause a clarification.
- The system must never change 26 to a nearby available date such as 24 or 27.

### 5. Add on-demand STT rescue

If the primary Assamese transcript has low confidence or produces no valid value, reuse only that short buffered utterance with English/Hindi recognition as a fallback.

Accept a fallback only when it maps safely to the current real options. If the transcripts disagree, ask the caller to repeat or say digits. Do not run several STT providers for every turn because that increases cost, latency and privacy exposure.

## Reply-language rule

Understanding language and reply language are different.

```text
Caller: “মই twenty-six October যাম।”
Meaning: 26 October
Agent reply: Assamese
```

The reply language should remain Assamese unless the caller clearly asks to continue in English or Hindi. One English date or time must not switch the whole conversation.

## Security and reliability rules

- Treat STT and LLM results as untrusted candidates.
- Keep the original text as evidence for the accepted value.
- Let the backend booking flow own state and next steps.
- Use only real doctor/date/slot IDs returned by tools.
- Never guess when two values are possible.
- Never say “booked” until the booking transaction returns success.
- Keep any saved evaluation audio private, consented and short-lived.

## How to prove it works

Test real recordings from different speakers with:

- Pure Assamese.
- Assamese sentences containing English dates, times and ages.
- Assamese sentences containing Hindi numbers.
- Romanized words and script changes produced by STT.
- Similar values such as 26/27 and 9:30/10:30.
- AM/PM ambiguity, background noise and phone-quality audio.

Measure exact date/time/age accuracy, wrong acceptance, clarification rate and response latency. Transcript quality alone is not enough; the final saved booking value must be checked.

## Final decision

| Question | Answer |
|---|---|
| Should users select a language for each value? | No |
| Can the LLM understand mixed text? | Yes, when STT gives usable text |
| Can the LLM repair every STT mistake? | No |
| Should we enable Deepgram multilingual now? | No; Assamese is not in its published multilingual list |
| Best solution | Assamese STT + complete multilingual normalizer + one structured LLM fallback + strict validation |

## Branch recommendation

Use a separate branch because this changes the central conversation path and needs controlled comparison testing.

Suggested branch name:

```text
codex/assamese-mixed-language-understanding
```

The repository rules say the user manages Git operations, so this review does not create the branch.

## Main references

- [Deepgram model and language support](https://developers.deepgram.com/docs/models-languages-overview/)
- [Deepgram Nova-3 multilingual language list](https://developers.deepgram.com/docs/nova-3-language-prompting)
- [Deepgram smart formatting limitations](https://developers.deepgram.com/docs/smart-format)
- [Deepgram key-term prompting](https://developers.deepgram.com/docs/keyterm)
- [Azure language identification limitations](https://learn.microsoft.com/azure/cognitive-services/speech-service/language-identification)
- [Vakyansh Assamese/Hindi/English inverse text normalization](https://open-speech-ekstep.github.io/inverse_text_normalization/)

