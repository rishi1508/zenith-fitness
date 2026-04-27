/**
 * Pre-written form cues for common lifts. Loaded into the Coach view
 * so users can pull up technique reminders without leaving the app.
 *
 * The lookup is intentionally fuzzy: a user-entered exercise name like
 * "BB Bench" or "Flat Barbell Bench Press" should still resolve to
 * "Bench Press". `getFormCues` does a case-insensitive substring match
 * on the canonical key, picking the longest matching key so e.g.
 * "Incline Bench Press" wins over plain "Bench Press" when both
 * substrings would match.
 *
 * Cues are ordered by importance (top of the list = most common form
 * mistake). Compound lifts get 4–6 cues; isolations 2–3.
 */

export interface FormCueEntry {
  /** Display name shown in the picker. */
  name: string;
  /** Lower-cased lookup key. Inputs are matched against this (and the
   *  optional aliases) via substring / token match. */
  key: string;
  /** Optional alternate spellings. e.g. "BB Bench" → "Bench Press". */
  aliases?: string[];
  /** Coarse category for grouping in the UI. */
  group: 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core';
  cues: string[];
}

export const FORM_CUES: FormCueEntry[] = [
  // ---------- CHEST ----------
  {
    name: 'Bench Press',
    key: 'bench press',
    aliases: ['bench', 'flat bench', 'barbell bench', 'bb bench'],
    group: 'chest',
    cues: [
      'Plant your feet flat and drive them into the floor — leg drive matters.',
      'Retract your shoulder blades and pin them to the bench. Big chest.',
      'Bar path: lower to mid-chest / nipple line, press up and slightly back.',
      'Wrists stacked over elbows — no bent wrists.',
      'Tuck elbows ~45–60° from the torso, not flared 90°.',
      'Pause briefly on the chest, no bouncing.',
    ],
  },
  {
    name: 'Incline Bench Press',
    key: 'incline bench press',
    aliases: ['incline bench', 'incline barbell', 'incline bb'],
    group: 'chest',
    cues: [
      'Bench angle ~30°. Higher than 45° turns it into a shoulder press.',
      'Lower the bar to upper chest / clavicle, not your face.',
      'Same shoulder-blade retraction as flat bench — keep the chest proud.',
      'Drive heels into the floor for stability.',
      'Slight pause at the chest — incline rewards control.',
    ],
  },
  {
    name: 'Dumbbell Bench Press',
    key: 'dumbbell bench press',
    aliases: ['db bench', 'dumbbell bench', 'flat dumbbell press'],
    group: 'chest',
    cues: [
      'Kick the dumbbells up onto your thighs, then rock back as you lay down.',
      'At the bottom, dumbbells just outside the chest with wrists stacked.',
      'Press up and slightly in — paths converge but don\'t clang at the top.',
      'Don\'t lock out hard; keep tension on the chest.',
    ],
  },
  {
    name: 'Incline Dumbbell Press',
    key: 'incline dumbbell press',
    aliases: ['incline db press', 'incline db'],
    group: 'chest',
    cues: [
      '~30° incline. Steeper benches shift work to the front delts.',
      'Lower until upper arm is roughly parallel to the floor.',
      'Wrists stacked over elbows the entire range of motion.',
    ],
  },
  {
    name: 'Cable Fly',
    key: 'cable fly',
    aliases: ['cable crossover', 'pec fly', 'pec deck'],
    group: 'chest',
    cues: [
      'Slight bend at the elbows — fixed angle the whole rep.',
      'Squeeze the chest at the bottom; pause for a second.',
      'Don\'t swing weight with the torso; isolate the pecs.',
    ],
  },
  {
    name: 'Push-Up',
    key: 'push-up',
    aliases: ['push up', 'pushup', 'pushups'],
    group: 'chest',
    cues: [
      'Body in a straight line — no sagging hips, no piked hips.',
      'Hands roughly under shoulders or slightly wider.',
      'Lower until chest grazes the floor; full range each rep.',
    ],
  },

  // ---------- BACK ----------
  {
    name: 'Deadlift',
    key: 'deadlift',
    aliases: ['conventional deadlift', 'dl'],
    group: 'back',
    cues: [
      'Bar over mid-foot before you grip; bar pulled in tight to the shins.',
      'Hips low enough to load hamstrings, not so low it becomes a squat.',
      'Pull the slack out of the bar before initiating the lift.',
      'Drive the floor away with both feet — chest and hips rise together.',
      'Lockout: hips through, glutes squeezed. No hyperextension.',
      'Reset every rep. No bouncing the plates.',
    ],
  },
  {
    name: 'Romanian Deadlift',
    key: 'romanian deadlift',
    aliases: ['rdl', 'stiff leg deadlift', 'sldl'],
    group: 'back',
    cues: [
      'Soft knees, not locked, not bent. Knees stay roughly fixed.',
      'Hinge at the hips — push the butt back like closing a car door.',
      'Bar stays close to the legs — drag it down the thighs.',
      'Stop when you feel a hamstring stretch, not when the floor is reached.',
    ],
  },
  {
    name: 'Pull-Up',
    key: 'pull-up',
    aliases: ['pullup', 'pull up', 'chin-up', 'chinup'],
    group: 'back',
    cues: [
      'Start from a dead hang — full extension before each rep.',
      'Drive elbows down and back, think about pulling the bar TO you.',
      'Chest up; chin clears the bar at the top.',
      'Lower under control — don\'t free-fall.',
    ],
  },
  {
    name: 'Lat Pulldown',
    key: 'lat pulldown',
    aliases: ['pulldown'],
    group: 'back',
    cues: [
      'Slight backward lean (~15°), chest up, no momentum.',
      'Pull the bar to upper chest, not behind the neck.',
      'Drive elbows down and back; lats do the work, not biceps.',
      'Control the eccentric — let the bar rise slowly.',
    ],
  },
  {
    name: 'Barbell Row',
    key: 'barbell row',
    aliases: ['bb row', 'bent over row', 'pendlay row'],
    group: 'back',
    cues: [
      'Hinge to ~45–60°. Flatter back rewards lats; steeper involves more upper back.',
      'Pull the bar to lower chest / upper abs.',
      'Squeeze the shoulder blades together at the top.',
      'No torso swinging — strict reps build more back.',
    ],
  },
  {
    name: 'Dumbbell Row',
    key: 'dumbbell row',
    aliases: ['db row', 'one arm row', 'single arm row'],
    group: 'back',
    cues: [
      'Brace one hand and one knee on the bench; flat back.',
      'Pull elbow up and back, not out — drag the dumbbell along the side.',
      'Squeeze at the top, full stretch at the bottom.',
    ],
  },
  {
    name: 'Cable Row',
    key: 'cable row',
    aliases: ['seated cable row', 'low row'],
    group: 'back',
    cues: [
      'Sit tall, chest up; don\'t round at the start.',
      'Pull handle to lower stomach; squeeze the shoulder blades.',
      'Slight torso lean back is fine; don\'t rock for momentum.',
    ],
  },
  {
    name: 'Face Pull',
    key: 'face pull',
    group: 'back',
    cues: [
      'Pull rope toward the eyes / forehead, not the chin.',
      'Elbows high, externally rotated — thumbs back at the end.',
      'High reps (12–20). It\'s a posture lift, not a strength lift.',
    ],
  },

  // ---------- LEGS ----------
  {
    name: 'Squat',
    key: 'squat',
    aliases: ['back squat', 'high bar squat', 'low bar squat'],
    group: 'legs',
    cues: [
      'Bar position: high bar on traps OR low bar across rear delts. Pick one and stick with it.',
      'Brace HARD — air into the belly, not the chest.',
      'Knees track over toes. Don\'t let them cave.',
      'Hips and shoulders rise together out of the hole.',
      'Depth: at minimum hip crease below the top of the knee.',
      'Don\'t lose the upper-back tightness — chest stays up.',
    ],
  },
  {
    name: 'Front Squat',
    key: 'front squat',
    group: 'legs',
    cues: [
      'Elbows HIGH, upper arms parallel to floor. Bar sits on shoulders, fingers just steer.',
      'More upright torso than back squat — quad-dominant.',
      'Brace the core; if elbows drop, the bar will roll.',
      'Sit straight down — don\'t let the hips shoot back.',
    ],
  },
  {
    name: 'Leg Press',
    key: 'leg press',
    group: 'legs',
    cues: [
      'Feet shoulder-width on the platform; foot position changes which muscle works.',
      'Lower until knees ~90° — don\'t let lower back round under load.',
      'Don\'t lock out at the top; keep tension on the quads.',
    ],
  },
  {
    name: 'Lunge',
    key: 'lunge',
    aliases: ['walking lunge', 'reverse lunge'],
    group: 'legs',
    cues: [
      'Long step — short step turns this into a step-up.',
      'Front shin roughly vertical at the bottom; back knee just above the floor.',
      'Drive through the front heel to come up.',
    ],
  },
  {
    name: 'Bulgarian Split Squat',
    key: 'bulgarian split squat',
    aliases: ['split squat', 'rear foot elevated split squat', 'bss'],
    group: 'legs',
    cues: [
      'Front foot far enough that the front knee doesn\'t shoot past the toes excessively.',
      'Most of the weight on the front leg — back leg is for balance.',
      'Drop straight down, not forward. Drive through the front heel.',
    ],
  },
  {
    name: 'Leg Curl',
    key: 'leg curl',
    aliases: ['hamstring curl', 'lying leg curl', 'seated leg curl'],
    group: 'legs',
    cues: [
      'Drive the heels toward the glutes; squeeze at the top.',
      'Don\'t let the hips lift off the pad on the lying version.',
      'Slow eccentric — hamstrings respond to time under tension.',
    ],
  },
  {
    name: 'Leg Extension',
    key: 'leg extension',
    aliases: ['quad extension'],
    group: 'legs',
    cues: [
      'Knee axis lined up with the machine pivot.',
      'Squeeze hard at full extension; pause for a second.',
      'Higher reps (10–15+) — quads are mostly fast-twitch but isolations love volume.',
    ],
  },
  {
    name: 'Calf Raise',
    key: 'calf raise',
    aliases: ['standing calf raise', 'seated calf raise'],
    group: 'legs',
    cues: [
      'Full range of motion: deep stretch at the bottom, all the way up at the top.',
      'Pause at the top (count to 1) — calves love isometric tension.',
      'Slow eccentric. No bouncing.',
    ],
  },
  {
    name: 'Hip Thrust',
    key: 'hip thrust',
    aliases: ['barbell hip thrust', 'glute bridge'],
    group: 'legs',
    cues: [
      'Upper back on the bench; bar over the hips with a pad.',
      'Drive through the heels; squeeze the glutes hard at the top.',
      'Ribs down at lockout — don\'t hyperextend the lower back.',
    ],
  },

  // ---------- SHOULDERS ----------
  {
    name: 'Overhead Press',
    key: 'overhead press',
    aliases: ['ohp', 'standing press', 'military press', 'shoulder press'],
    group: 'shoulders',
    cues: [
      'Bar starts on the front delts, not floating in front.',
      'Squeeze glutes; brace abs. The whole body stabilizes the press.',
      'Press the bar in a straight line — chin tucks back as bar passes the face.',
      'Lockout: bicep beside the ear, not in front of it. Shrug at the top.',
    ],
  },
  {
    name: 'Dumbbell Shoulder Press',
    key: 'dumbbell shoulder press',
    aliases: ['db shoulder press', 'seated dumbbell press', 'arnold press'],
    group: 'shoulders',
    cues: [
      'Start at the side of the head, palms forward.',
      'Press up and slightly in — the dumbbells should converge but not clang.',
      'Don\'t lock out — keep tension on the delts.',
    ],
  },
  {
    name: 'Lateral Raise',
    key: 'lateral raise',
    aliases: ['side raise', 'side lateral raise', 'db lateral raise'],
    group: 'shoulders',
    cues: [
      'Slight forward lean; lead with the elbows, not the wrists.',
      'Stop at shoulder height — going higher trains traps, not delts.',
      'High reps (10–15+) and slow tempo — heavy ego lifts here are useless.',
    ],
  },
  {
    name: 'Rear Delt Fly',
    key: 'rear delt fly',
    aliases: ['reverse fly', 'reverse pec deck'],
    group: 'shoulders',
    cues: [
      'Slight bend in the elbow, fixed for the entire rep.',
      'Squeeze the shoulder blades back — feel it in the rear delts, not the upper back.',
      'Don\'t use the lower back to throw the weight up.',
    ],
  },

  // ---------- ARMS ----------
  {
    name: 'Barbell Curl',
    key: 'barbell curl',
    aliases: ['bb curl', 'standing curl'],
    group: 'arms',
    cues: [
      'Elbows pinned to the sides — they shouldn\'t drift forward.',
      'No body english. If you have to swing, the weight is too heavy.',
      'Squeeze at the top; full stretch at the bottom.',
    ],
  },
  {
    name: 'Hammer Curl',
    key: 'hammer curl',
    aliases: ['db hammer curl'],
    group: 'arms',
    cues: [
      'Neutral grip (palms facing each other) the whole rep.',
      'Targets brachialis — go heavier than supinated curls.',
      'Elbows fixed; no swinging.',
    ],
  },
  {
    name: 'Tricep Pushdown',
    key: 'tricep pushdown',
    aliases: ['cable pushdown', 'rope pushdown'],
    group: 'arms',
    cues: [
      'Elbows pinned to the ribs; don\'t flare them out.',
      'Lock out hard at the bottom; squeeze the triceps.',
      'Slight forward lean is fine — full extension is the goal.',
    ],
  },
  {
    name: 'Skull Crusher',
    key: 'skull crusher',
    aliases: ['lying tricep extension', 'french press'],
    group: 'arms',
    cues: [
      'Keep the elbows pointing at the ceiling — don\'t let them flare out.',
      'Lower the bar behind the head, not to the forehead, for full stretch.',
      'Use an EZ bar if straight bar bothers your wrists.',
    ],
  },
  {
    name: 'Dip',
    key: 'dip',
    aliases: ['tricep dip', 'parallel bar dip'],
    group: 'arms',
    cues: [
      'Lean forward = more chest; stay upright = more triceps.',
      'Lower until upper arms are roughly parallel to the floor.',
      'Don\'t let the shoulders shrug up to the ears.',
    ],
  },

  // ---------- CORE ----------
  {
    name: 'Plank',
    key: 'plank',
    group: 'core',
    cues: [
      'Forearms under shoulders; body in a straight line.',
      'Squeeze glutes and brace abs — don\'t sag through the hips.',
      'Quality over time. Stop when the form breaks down.',
    ],
  },
  {
    name: 'Hanging Leg Raise',
    key: 'hanging leg raise',
    aliases: ['leg raise', 'knee raise'],
    group: 'core',
    cues: [
      'Don\'t swing — pause briefly at the bottom each rep.',
      'Curl the pelvis up at the top, not just lift the legs.',
      'Strict tempo: slow up, slow down. No momentum.',
    ],
  },
];

/**
 * Resolve a user-entered exercise name to its form-cue entry. Looks for
 * an exact match first, then a substring match (longest key wins so
 * "Incline Bench Press" beats "Bench Press" when both would match).
 *
 * Returns null if no match — the caller should treat that as "no cues
 * available" rather than crashing the UI.
 */
export function findFormCues(exerciseName: string): FormCueEntry | null {
  if (!exerciseName) return null;
  const q = exerciseName.trim().toLowerCase();
  if (q.length === 0) return null;

  let best: { entry: FormCueEntry; matchLen: number } | null = null;
  for (const entry of FORM_CUES) {
    const candidates = [entry.key, ...(entry.aliases || [])];
    for (const cand of candidates) {
      if (q === cand) return entry; // exact match wins immediately
      if (q.includes(cand) || cand.includes(q)) {
        const matchLen = Math.min(q.length, cand.length);
        if (!best || matchLen > best.matchLen) {
          best = { entry, matchLen };
        }
      }
    }
  }
  return best?.entry || null;
}

/** All form-cue entries grouped by muscle category for the picker. */
export function listFormCuesByGroup(): Record<FormCueEntry['group'], FormCueEntry[]> {
  const out: Record<FormCueEntry['group'], FormCueEntry[]> = {
    chest: [], back: [], legs: [], shoulders: [], arms: [], core: [],
  };
  for (const e of FORM_CUES) out[e.group].push(e);
  return out;
}
