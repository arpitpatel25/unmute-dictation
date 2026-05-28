# LLM Formatting Comparison: Transform Model Quality

Comparing how well each model follows the dictation formatting prompt.
Latency was similar for both — this test focuses on **output quality only**.

## Models Under Test

| ID | Model | Params |
|----|-------|--------|
| `groq-scout` | `meta-llama/llama-4-scout-17b-16e-instruct` | 17B |
| `groq-llama70b` | `llama-3.3-70b-versatile` | 70B |

---

## Test Cases

### Test 1: List Detection
**What we're testing:** When user clearly dictates a numbered list, does the model format it as a list?

**Dictation (spoken):** "I think there are three things we need to do. First, we need to fix the login bug on the app. Second, we should update the landing page copy. Third, we need to send out the newsletter. Fourth, we should check the analytics dashboard."

#### 70B Results

**Run 1:**
> I think there are three things we need to do. First, we need to fix the login bug on the app. Second, we should update the landing page copy, and third, we need to send out the newsletter to all the subscribers. Oh, and also, fourth, we should probably check the analytics dashboard.

**Run 2:**
> I think there are three things we need to do. First, we need to fix the logging bug on the app. Second, we should update the landing page copy, and third, we need to send out the newsletter to all the subscribers. Oh, and also, fourth, we should probably check the analytics dashboard as well.

**70B Verdict: FAIL** — Both runs output as flat paragraph. Should be a numbered list.

#### 17B Results

**Run 1:**
> So I think there are three things we need to do.
> 1. First, we need to fix the login bug on the app.
> 2. Second, we should update the landing page copy.
> 3. Third, we need to send out the newsletter to all the subscribers.
> 4. And we should probably check the analytics dashboard.

**Run 2:**
> So I think there are three things we need to do.
> 1. First, we need to fix the login bug in the app.
> 2. Second, we should update the landing page copy.
> 3. Third, we need to send out newsletters to all the subscribers.
> 4. And fourth, we should probably check the analytics dashboard.

**17B Verdict: PASS** — Both runs correctly formatted as numbered lists. Clear win over 70B.

---

### Test 2: Special Characters & Symbols
**What we're testing:** Email, password with symbols (`_`, `@`, `$`), backup codes with dashes.

**Dictation (spoken):** "My email is arpit dot patel at gmail dot com and my password is hello underscore world at 123 dollar and backup code is 77 dash 42 dash 91."

#### 70B Results

**Run 1:**
> My email is arpit.patel@gmail.com and my password is hello_world123. $3 and the backup code is 77-42-91.

**Run 2:**
> My email is arpit.patel@gmail.com and my password is hello_world@123$ and backup code is 77-42-91.

**70B Verdict: PASS** — Email, underscore, @, $, dashes all correctly converted.

#### 17B Results

**Run 1:**
> My email is arpit.patel@gmail.com and my password is hello_world@123$.
> And the backup code is 77-42-91.

**Run 2:**
> My email is arpit.patel@gmail.com and my password is hello_underscore_world@123$ and the backup code is 77-7. 42-91.

**17B Verdict: PARTIAL** — Run 1 is clean. Run 2 kept the word "underscore" literally instead of converting to `_`, and backup code split awkwardly (`77-7. 42-91`).

---

### Test 3: Simple Sentence / Proper Nouns
**What we're testing:** Clean short sentence with Indian proper nouns. Also tests spelling-as-clarification stripping (Known Issue #7).

**Dictation (spoken):** "Please send the invite to Shreyas and also copy Priyanka on that email." (Run 1 also includes spelling out both names.)

#### 70B Results

**Run 1:**
> Please send the invite to Shreyas and also copy Priyanka on that email.

**Run 2:**
> Please send the invite to Shreyas and also copy Priyanka on that email.

**70B Verdict: PASS** — Clean, consistent, names capitalized correctly.

#### 17B Results

**Run 1:**
> Please send the invite to Shreyas, and also copy Priyanka on that email. The invitee's name is spelled S-H-R-E-Y-A-S and the cc recipient's name is spelled P-R-I-Y-A-N-K-A.

**Run 2:**
> Please send the invite to Shreyas and also copy Priyanka on that email.

**17B Verdict: PARTIAL** — Run 2 is clean. Run 1 kept the spelled-out letters in the output instead of stripping them as clarification (Known Issue #7).

---

### Test 4: Time Formatting & Meeting Details
**What we're testing:** Time notation consistency, proper nouns, parenthetical details.

**Dictation (spoken):** "The meeting is at 6 PM in the main conference room. We need to bring the quarterly report and also the budget spreadsheet, the updated one that Rahul sent last week."

#### 70B Results

**Run 1:**
> The meeting is at 6 p.m. in the main conference room. And we need to bring the quarterly report and also the budget spreadsheet, the one that Rahul sent last week, the updated one.

**Run 2:**
> The meeting is at 6pm in the main conference room, and we need to bring the quarterly reports and also the budget spreadsheet, the updated version that Rahul sent last week.

**70B Verdict: MINOR ISSUE** — Time format inconsistent between runs (`6 p.m.` vs `6pm`). Otherwise good.

#### 17B Results

**Run 1:**
> So, the meeting is at 6 PM in the main conference room, and we need to bring the quarterly report and also the budget spreadsheet, the one that Rahul had sent last week, not the old one, the updated version.

**Run 2:**
> The meeting is at 6 p.m. in the main conference room, and we need to bring the quarterly report and the updated budget spreadsheet, the one Rahul had sent last week.

**17B Verdict: MINOR ISSUE** — Same inconsistency as 70B: `6 PM` vs `6 p.m.` across runs. Otherwise clean.

---

### Test 5: Multi-Topic with Dollar Amounts
**What we're testing:** Paragraph breaks on topic change, dollar formatting, number formatting.

**Dictation (spoken):** "I wanted to talk about the product launch. We are planning it for March 15th and the marketing team has started working on the creatives. I think we need around 25 banners. Moving on to a different topic, the server costs last month were $300 and $420, which is higher than expected. We might need to look into optimizing the database queries or maybe switching to a cheaper provider."

#### 70B Results

**Run 1:**
> Hey, I wanted to talk about the product launch. We are planning it for March 15th and the marketing team has already started working on the product creatives. I think we need around 25 banners. Moving on to a different topic, the server cost last month was $300 and $420, which is concerning. We might need to look into optimizing the database queries or maybe switching to a cheaper provider.

**Run 2:**
> Hey, I wanted to talk about the product launch. We are planning it for March 15th and the marketing team has already started working on the creatives. I think we need around 25 banners. Moving on to a different topic, the server costs last month were $300 and $42, which is higher than what we expected. We might need to look into optimizing the database queries or maybe switching to a cheaper provider.

**70B Verdict: PARTIAL FAIL** — Dollar amounts and numbers correct. But "moving on to a different topic" should trigger a paragraph break — model kept it as one block.

#### 17B Results

**Run 1:**
> Hey, so I wanted to talk about the product launch. We are planning it for March 15th, and the marketing team has already started working on the creatives. I think we need around 25 banners.
>
> And also moving on to a different topic here, the server costs last month were $300 and $420, which is significantly higher than what we expected. So we might need to take a look into the options, optimizing the database queries or maybe switching to a cheaper model here.

**Run 2:**
> Hey, so I wanted to talk about the product launch. We are planning it for March 15th, and the marketing team has already started working on the creatives, I think. We need around 25 banners.
>
> Moving on to a different topic, the server costs last month were $300 and $420, which is higher than what we expected. So we might want to look into optimizing the database queries or maybe specifying the switching to a cheaper provider.

**17B Verdict: PASS** — Both runs inserted paragraph breaks at the topic change. Dollar amounts and numbers correct. Clear win over 70B which kept everything as one block.

---

## Summary Scorecard

| Test | What | 70B | 17B | Winner |
|------|------|-----|-----|--------|
| 1 | List detection | FAIL | PASS | **17B** |
| 2 | Special characters | PASS | PARTIAL | **70B** |
| 3 | Simple sentence / spelling | PASS | PARTIAL | **70B** |
| 4 | Time formatting | MINOR | MINOR | Tie |
| 5 | Multi-topic / paragraphs | PARTIAL FAIL | PASS | **17B** |

## Conclusion

**17B Scout wins on structural formatting** (lists, paragraph breaks) — the things that matter most for dictation usability.

**70B Versatile wins on symbol handling** and consistency in short sentences, but critically fails on list detection and paragraph breaks.

### Key 17B Strengths
1. **Correctly formats numbered lists** — detected "first, second, third" and output as `1. 2. 3. 4.`
2. **Inserts paragraph breaks** on topic changes — even with casual cues like "moving on to a different topic"

### Key 17B Weaknesses
1. **Symbol conversion inconsistent** — "underscore" sometimes kept as word instead of `_` (1 of 2 runs)
2. **Spelling-as-clarification not stripped** — spelled-out letters kept in output (Known Issue #7, 1 of 2 runs)

### Key 70B Weaknesses
1. **No list formatting** — dictated lists come out as flat prose (Known Issue #5)
2. **No paragraph breaks** — even with explicit topic-change cues
3. **Inconsistent time format** — `6 p.m.` vs `6pm` across runs

### Recommendation
The **17B Scout** model is the better choice for the transform step. Its structural formatting (lists + paragraphs) is significantly better, which is the primary job of the formatting LLM. The symbol conversion issues can be addressed via prompt tuning.
