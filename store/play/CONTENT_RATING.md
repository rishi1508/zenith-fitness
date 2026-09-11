# IARC content rating questionnaire — suggested answers

For Play Console → App content → Content ratings. Category: **Utility /
Productivity / Health & Fitness app** (not a game) — the IARC questionnaire
branches to a shorter set of questions for this category. Answers below
reflect what the app actually does; re-run the real questionnaire in Play
Console, since IARC's exact wording and branching can change.

## Violence

| Question | Answer |
|---|---|
| Does the app contain any violent content, or references to violence? | No |
| Depictions of realistic or fantasy violence? | No |

Zenith is a workout/nutrition/gym-management tool; no depicted violence of
any kind.

## Sexuality

| Question | Answer |
|---|---|
| Any sexual content or nudity? | No |
| Any suggestive content? | No |

## Language / profanity

| Question | Answer |
|---|---|
| Does the app itself contain profanity? | No |
| Can users encounter profanity through user-generated content? | Possible, unmoderated-by-default (see User-generated content below) |

Buddy chat, gym feed posts/comments and shared exercise/food notes are free
text a user types (`chats/{chatId}/messages`, `src/gymFeed.ts`,
`sharedExercises`/`sharedFoods` — `firestore.rules`); nothing prevents
profanity in that text, so answer honestly that user-generated text is not
pre-filtered, only moderated after the fact (below).

## Controlled substances

| Question | Answer |
|---|---|
| References to illegal drugs, alcohol, tobacco? | No |

## Gambling / simulated gambling

| Question | Answer |
|---|---|
| Simulated gambling? | No |
| Facilitates real-money gambling? | No |

## Miscellaneous / other

| Question | Answer | Justification |
|---|---|---|
| Does the app share the user's location with other users or third parties? | **No** | No location permission is even declared on Android (see `store/play/DATA_SAFETY.md` Location section); the one gym check-in record stores a distance in metres, never a coordinate, and only that gym's staff can read it — never shown to other members or any third party. |
| Does the app allow users to purchase digital goods? | **No** | No in-app purchases, no billing SDK; premium is granted by the gym or an admin, never bought. |
| Does the app contain user-generated content (UGC)? | **Yes** | Buddy chat, gym feed posts/comments/photos, profile text, shared exercise/food entries. |
| Is the UGC moderated? | **Yes, by gym staff and admins, not pre-screened** | Gym staff/admin can delete any feed post or comment in their gym (`firestore.rules` `feed/{postId}` and `comments/{commentId}` delete rules: `isGymStaff(gymId) \|\| isAdmin()`); a small admin allowlist can edit/delete any `sharedExercises`/`sharedFoods`/`sharedMeals` entry (`isAdmin()` in the same rules file). There is no pre-publication filter — moderation is after-the-fact removal. |
| Can users interact/communicate with other users? | **Yes** | Buddy chat (text), gym feed posts/comments/reactions, buddy requests/follows. Text only — no voice/video calling, no file/media sharing beyond photos already covered in Data safety. |
| Does the app share personal info with third parties for advertising? | **No** | No ads, no ad SDK, no analytics/advertising identifiers collected (see Data safety). |

## Notes for whoever submits this in Play Console

- The questionnaire's exact question set is IARC's and can differ slightly
  by locale/version; the table above is the honest answer to each
  well-known IARC branch for a non-game utility app, not a guarantee of the
  live wording.
- If the "communication" or "UGC" answers ever need a stronger claim (e.g.
  "pre-moderated"), that would require adding actual pre-publication
  filtering, which the app doesn't have today — don't answer stronger than
  what's true.
