# Known Issues

Tracked issues observed during testing. All are equal priority. To be addressed after core functionality is complete.

---

### 1. Chunking metadata leaking into output
**Component:** LLM formatting / chunking pipeline
**Issue:** When audio is long enough to trigger chunking, the response exposes internal chunk structure to the user (e.g., "Chunk 1: ...", "Chunk 2: ..."). The user should receive seamless, merged output with no indication that chunking occurred.
**Expected:** Output is a single clean block of text with no chunk labels or numbering.

### 2. Phantom "thank you" appended to transcriptions
**Component:** STT (Groq Whisper) / chunking
**Issue:** Most transcriptions end with "thank you" that the user never said. Appears to be a hallucination from the STT model, especially common at chunk boundaries or during silence at the end of a recording.
**Expected:** Output should only contain what the user actually said. Trailing silence should not produce phantom words.

### 3. Spelled-out words retained alongside the actual word
**Component:** LLM formatting
**Issue:** When a user spells out a word for accuracy (e.g., "Hinglish, H-I-N-G-L-I-S-H"), the output contains both the word and the spelled-out letters (e.g., "Hinglish H-I-N-G-L-I-S-H"). The spelling was provided as a hint for correct spelling, not as intended output.
**Expected:** Only the correctly-spelled word should appear in the output. The letter-by-letter spelling should be treated as a correction signal and stripped from the final text.

### 4. Sarvam (Hinglish) outputs digit "1" instead of word "one"
**Component:** STT (Sarvam) / Hinglish pipeline
**Issue:** When users say "one" in a Hinglish context, Sarvam transcribes it as the digit `1` instead of the word `one`. The LLM formatting step doesn't correct this based on context.
**Expected:** Contextually appropriate representation — use the word "one" when it fits the sentence context, use the digit `1` only when the user is clearly dictating a number.

### 5. LLM formatting step frequently outputs raw unformatted text
**Component:** LLM formatting (English-only Whisper model pipeline)
**Issue:** The LLM step responsible for formatting the raw STT transcript fails roughly half the time — it passes through the raw transcription verbatim with no formatting applied. This means no punctuation correction, no paragraph breaks, no bullet points, and no structural organization. For example, when a user dictates a list of points, the output should be formatted as a numbered or bulleted list, but instead comes out as a single run-on block of text. This issue is specific to the English-only Whisper model path.
**Expected:** The LLM formatting step should consistently apply proper formatting: correct punctuation, paragraph breaks where appropriate, bullet/numbered lists when the user is clearly listing items, and overall structural organization that matches the intent of the spoken content.

### 6. Special characters and symbols not handled in dictation
**Component:** LLM formatting
**Type:** Enhancement
**Issue:** Users frequently need to dictate text containing special characters and symbols — for example, passwords (e.g., saying "underscore" or "at symbol"), phone numbers, email addresses, or code snippets. Currently, when a user says words like "underscore", "at", "at symbol", "hash", "dollar sign", "dot", "slash", "backslash", "exclamation mark", etc., the LLM formatting step does not reliably convert these spoken descriptions into their corresponding symbols (`_`, `@`, `#`, `$`, `.`, `/`, `\`, `!`, etc.). This makes it impossible to accurately dictate passwords, email addresses, URLs, phone numbers with specific formatting, or any text requiring special characters.
**Expected:** The LLM formatting step should recognize spoken descriptions of symbols and convert them to the actual characters. Examples: "at" or "at symbol" → `@`, "underscore" → `_`, "hash" → `#`, "dot" or "period" → `.`, "forward slash" → `/`, "hyphen" or "dash" → `-`, "plus" → `+`, "star" or "asterisk" → `*`. This should work contextually — "at" in "meet me at the park" should remain the word "at", but "john at gmail dot com" should produce `john@gmail.com`.

### 7. Spelled word and spoken word both appear in output (expanded scope of #3)
**Component:** LLM formatting
**Issue:** This extends issue #3. The problem is broader than just spelling-then-word — it also occurs when a user says the word first and then spells it for clarity (e.g., "My name is Zodiak, Z-O-D-I-A-K"), or spells it first and then says the word (e.g., "Z-O-D-I-A-K, Zodiak"). In both cases, the output retains both the spelled-out letters and the word itself. The LLM formatting step does not recognize that the spelling is a clarification signal, regardless of whether it comes before or after the word.
**Expected:** Only the final intended word should appear in the output. Whether the user says the word then spells it, or spells it then says the word, the output should contain only the correctly-spelled word. The letter-by-letter spelling should always be treated as a correction/clarification hint and stripped entirely from the final text.
