// The Hush: story scenes for Dialogue Dungeon.
//
// Structure
//   Prologue          plays on a pupil's first visit to the village (so the premise is there from Level 1).
//   Act n (1 to 10)   The Calling   unlocks at Level 10n and plays in the village.
//                     The Reckoning unlocks when the boss floor 10n is cleared (and the pupil is at least Level 10n,
//                     so it never plays before its Calling) and plays on the victory screen.
//   Epilogue          unlocks with the Act 10 Reckoning.
//   Mid-boss notes    short found notes on floors 5, 15, 25 ... 95, unlocked when that floor is cleared.
//
// Nothing here needs a database change: what is unlocked is worked out from the pupil's level and floor_kills,
// and the scenes a pupil has already been shown are kept in floor_kills.sty (a list of scene ids).
// The text of a scene only leaves the server once it is unlocked (see storyState), like the job tree.
//
// Every scene is 80 words or fewer, uses British spelling and models correct speech punctuation (test/story.test.mjs checks the length).
//
// TO EXPAND LATER: add acts to ACTS (level and floor are 10 x act), raise TOP_FLOOR in gamedata.js, and add notes to NOTES.
// Open threads left for future chapters: the Deep Verse (floor 101+), other silent villages that need their own Voice-bearers,
// where the Hush first came from, new classes or skills sent out by the mended Chorus, and Ilse and the Archivist's redemption.

export const ACTS = [
  {
    n: 1, title: 'The Silent Village', zone: 'Cellar (floors 1 to 10)',
    calling: [
      'The bell in Parley’s square hangs silent. Elder Wren, the town crier, holds up a chalkboard: THE HUSH TOOK MY VOICE.',
      'Captain Brisk presses a brass badge into your hand. “You’ve reached Level 10, so you’re ready for the Lantern Guild’s charter,” she says. “Welcome, Adventurer.”',
      '“Wren’s voice went down the Cellar stairs,” squeaks Quip. “Something down there is wearing it! Reach Floor 10!”',
    ],
    reckoning: [
      'The Mimic Emperor topples from his chest-shaped throne. A glowing ribbon of sound floats out of his jaws and drifts all the way up the stairs to Parley.',
      'It curls around Elder Wren’s throat. She coughs. Then, in a cracked whisper, she says, “Hello.”',
      'It is only one word, but the whole village cheers.',
      '“One down,” says Quip. “Next, the Tunnels. Something in there keeps saying the wrong things!”',
    ],
  },
  {
    n: 2, title: 'The Rumour Tunnels', zone: 'Tunnels (floors 11 to 25)',
    calling: [
      'Parley is arguing again. “You told me the bridge was closed!” “I never said that!” Nobody can remember who said what.',
      'Tally the shopkeeper waves a crumpled note. “Rumours are coming up from the Tunnels,” she says. “Each one starts with ‘someone said’ and never tells us who.”',
      'Quip’s quotation marks glow. “Find the one spreading them,” it whispers. “Reach Floor 20!”',
    ],
    reckoning: [
      'The Hydra Queen’s seven heads hiss seven different stories at once. One by one they fall silent, until only the last head remains.',
      '“I only repeated what I heard,” it mumbles. “I never knew who said it.”',
      'You write the speaker’s name beside every word, and the rumours scatter like moths.',
      '“A good storyteller always says who is speaking,” says Quip.',
    ],
  },
  {
    n: 3, title: 'The Loud Warren', zone: 'Goblin Warren (floors 26 to 45)',
    calling: [
      'Boom. Boom. Boom. Drums from the Goblin Warren rattle the cups in Tally’s shop. Shouted orders echo up the stairs, and nobody in Parley can hear a thing.',
      'Captain Brisk’s face is grim. “Three Guild parties went down to find the source,” she says. “None came back.”',
      '“Then we bring them home,” says Quip, though its voice wobbles. “Reach Floor 30.”',
    ],
    reckoning: [
      'The Dread Overlord drops his war horn with a clang. Behind his throne, three Guild parties blink in the torchlight, hoarse from shouting.',
      '“We kept trying to warn you,” croaks a young scout. “But his orders were louder than we were.”',
      'You hold up the horn. It is cracked and quiet at last.',
      '“Being loud isn’t the same as being heard,” says Quip.',
    ],
  },
  {
    n: 4, title: 'The Void Beneath', zone: 'Goblin Warren depths (floors 36 to 45)',
    calling: [
      'Elder Wren pins a note to your door. In neat chalk it says: THE HUSH IS DEEPEST ON FLOOR 40.',
      'Below it, in a shakier hand: Be careful. Even my whisper is fading.',
      'Quip hovers close. “Nothing down there hums or rattles,” it says quietly. “It’s the quietest place in the whole dungeon. Reach Floor 40.”',
    ],
    reckoning: [
      'The Void Elemental folds in on itself with a soft pop. Behind it, a crack runs across the floor, thin as a hair and glowing faintly. Cold, silent air seeps out.',
      '“The Hush isn’t a monster,” Quip says slowly. “It’s a wound. Something far below has broken.”',
      'Down the crack, you hear a faint hum, like a choir singing from underwater.',
    ],
  },
  {
    n: 5, title: 'The Archivist’s Hall', zone: 'Bone Halls (floors 46 to 70)',
    calling: [
      'Captain Brisk unrolls a map so old it crackles. “The Guild’s oldest records call the Bone Halls an archive,” she says. “Long ago, a keeper called the Archivist guarded every voice in the land there.”',
      '“And now a Lich King sits in his chair,” says Quip. “He must know what’s wrong with the world below. Reach Floor 50!”',
    ],
    reckoning: [
      'The Lich King’s crown clatters to the floor. His voice is dry as old paper.',
      '“I was the Archivist,” he says. “I tried to keep every voice forever. But words that never change are not alive. My spell cracked the Chorus, the great heart of all voices.”',
      'He points downwards. “Someone slipped through that crack and has fed on the silence ever since.”',
    ],
  },
  {
    n: 6, title: 'The Echoes', zone: 'Bone Halls (floors 46 to 70)',
    calling: [
      'Elder Wren greets you with a full sentence. “Good morning, brave one,” she says, and the whole square gasps.',
      'Then, from the well, comes a second voice: “Good morning, brave one.” The words are right, but the voice is wrong.',
      '“The Hush is copying us,” says Quip, shivering. “I think it’s copying the bosses you’ve beaten, too. Reach Floor 60.”',
    ],
    reckoning: [
      'The Echo of the Mimic Emperor shatters like a dropped mirror. Each piece repeats your last words, then fades to nothing.',
      'Elder Wren laughs for the first time in years. “Did you hear that?” she asks. “I laughed out loud!”',
      '“Echoes aren’t real bosses,” says Quip. “They’re copies. Which means whoever is making them is watching you.”',
    ],
  },
  {
    n: 7, title: 'The Order of the Quill', zone: 'Bone Halls (floors 46 to 70)',
    calling: [
      'Tally holds up a silver badge shaped like a feather. “One of the Hollowed dropped this,” she says. “It belongs to the Order of the Quill, the Archivist’s old guards.”',
      'Captain Brisk frowns. “The Order vanished long ago. Why are their badges turning up now?”',
      '“Because someone is wearing them,” whispers Quip. “Reach Floor 70, and we’ll find out who.”',
    ],
    reckoning: [
      'The Echo of the Hydra Queen crumbles, leaving a sealed letter on the floor. You read it aloud:',
      '“The Order did not betray the Archivist. The Hush made us a promise: peace, if only we stopped speaking. One of us said yes. I am so sorry. — Warden Ilse”',
      'Quip’s glow dims. “So someone did say yes,” it whispers.',
    ],
  },
  {
    n: 8, title: 'The Dread Keep’s Guard', zone: 'Dread Keep (floors 71 to 100)',
    calling: [
      'A tired messenger staggers into Parley with news from the Dread Keep. “The guards aren’t monsters,” she gasps. “They’re people. Order of the Quill, wearing armour that won’t come off.”',
      'Captain Brisk’s hand tightens on her sword. “Then we must free them, not only fight them.”',
      '“Their old names might break the spell,” says Quip. “Reach Floor 80.”',
    ],
    reckoning: [
      'The Echo of the Dread Overlord falls silent. In the quiet, a new voice drifts up the stairwell, soft and patient.',
      '“Such lovely words you carry,” it says. “Why not rest them here with me?”',
      'Quip hides behind your shoulder. “That’s the Hushbinder,” it squeaks. “And it has been listening to us all this time!”',
    ],
  },
  {
    n: 9, title: 'The Last Silence', zone: 'Dread Keep (floors 71 to 100)',
    calling: [
      'Elder Wren speaks clearly now, though her eyes are sad. “I remember a warden from the Order,” she says. “Ilse, the best singer in all of Parley. Harsh words were said between her and the Archivist, and she swore never to speak again.”',
      'Quip gulps. “Ilse? From the letter?”',
      '“Reach Floor 90,” says Wren. “I think she’s waiting for us.”',
    ],
    reckoning: [
      'The Echo of the Void unravels, and a memory drifts out: a young warden singing in a bright hall. Her song breaks when an old man snaps at her.',
      '“I wish you would never sing again,” he says.',
      '“Very well,” she whispers.',
      'The memory fades. Quip sniffles. “It started with one unkind sentence,” it says, “and a promise nobody took back.”',
    ],
  },
  {
    n: 10, title: 'The Chorus', zone: 'Dread Keep (floors 71 to 100)',
    calling: [
      'All of Parley gathers in the square. Tally brings her shop bell. Captain Brisk brings her guild banner. Elder Wren brings her strongest voice.',
      '“Whatever waits on Floor 100,” says Wren, “we will not face it alone.”',
      'Quip’s quotation marks glow gold. “Every word you’ve ever written is ready,” it says. “Go on down, hero.”',
    ],
    // The finale is a choice. `reckoning` plays first, then the pupil picks; both paths end with `after`.
    reckoning: [
      'The Hushbinder kneels, and the Archivist’s crown slides from her head. “I only wanted the hurting words to stop,” says Ilse, and her voice is tiny.',
      'Behind her, the broken Chorus glows. You can seal the crack, or mend it with every voice in Parley.',
    ],
    choice: { seal: 'Seal the crack', mend: 'Mend it with every voice', sealReply: 'Quip flutters up beside you. “Sealing only hides the crack. Listen, can you hear Parley singing?”' },
    after: [
      'Elder Wren’s voice rings down the stairs. Tally’s bell follows. Then the whole village sings together.',
      'The Chorus blazes bright, and the silence breaks like glass.',
    ],
  },
];

export const PROLOGUE = {
  title: 'The Hush',
  text: [
    'Parley used to be the noisiest village in the valley. Now it is silent. Years ago, a creeping quiet called the Hush leaked out of the dungeon below. It steals voices and turns them into monsters called the Hollowed.',
    'Elder Wren, the town crier, hands you chalk. She cannot speak, so she writes: ONLY TRUE WORDS CAN HURT THE HOLLOWED.',
    '“You’re a Voice-bearer,” squeaks Quip, a lantern shaped like speech marks. “Your dialogue rings true. Let’s go!”',
  ],
};

export const EPILOGUE = {
  title: 'After the Chorus',
  text: [
    'Parley’s bell rings for the first time in years, and the whole valley hears it. Ilse hums a shy note, and Elder Wren hums back.',
    'Then Quip points. Under the mended Chorus, a spiral staircase winds down into the dark. A brass plaque reads: FLOOR 101.',
    'Beside it lies a letter from far away: Our village has gone quiet too. Please, can you help?',
  ],
};

// Found on the floor of every mid-boss (floors 5, 15 ... 95), unlocked when that floor is cleared.
export const NOTES = [
  { floor: 5, boss: 'Mimic Monarch', text: 'A note inside its chest: Practice makes perfect. The Emperor on Floor 10 is much better at stealing voices than I am!' },
  { floor: 15, boss: 'Cyclops Brawler', text: 'A scrap of paper is stuck to its club: DAY 14: the Tunnels keep whispering things that aren’t true. Don’t believe the rumours. — A Guild scout.' },
  { floor: 25, boss: 'Green Dragon', text: 'Its hoard holds a dented trumpet. “That’s from Parley’s old festival,” says Quip. “Someone is collecting things that make noise.”' },
  { floor: 35, boss: 'Shadowbeast Stalker', text: 'The dark swallows Quip’s glow. “It’s getting quieter,” it whispers. “Why is it getting quieter?”' },
  { floor: 45, boss: 'Draconic Warlord', text: 'His banner is embroidered with a quill. “I’ve seen that symbol before,” says Quip. “But where?”' },
  { floor: 55, boss: 'Hydra Matriarch', text: 'Her heads repeat your words back a second too late. “That’s strange,” murmurs Quip.' },
  { floor: 65, boss: 'Skeletal Wyvern Trainer', text: 'A silver feather badge is pinned inside his pocket. Quip taps it twice. “Order of the Quill,” it says.' },
  { floor: 75, boss: 'Lich Acolyte', text: 'A page from an old diary: I should apologise to Ilse. Tomorrow, I will find the words. The page ends there.' },
  { floor: 85, boss: 'Corrupt Paladin', text: 'He kneels when you read the name stitched inside his helmet. “Thank you,” he whispers, and the spell on his armour cracks.' },
  { floor: 95, boss: 'Dread Knight', text: 'He lowers his sword. “She’s waiting at the bottom,” he says. “She never wanted to hurt anyone. She only wanted the quiet.”' },
];

// From Floor 60 the Hush copies the bosses you have beaten, and Floor 100 is the Hushbinder (it reuses the Lich King sprite).
const BOSS_NAMES = { 60: 'Echo of the Mimic Emperor', 70: 'Echo of the Hydra Queen', 80: 'Echo of the Dread Overlord', 90: 'Echo of the Void Elemental', 100: 'The Hushbinder' };
export const bossLabel = (floor, kind, base, on) => (on && kind === 'boss' && BOSS_NAMES[floor] ? BOSS_NAMES[floor] + ' (Boss)' : base);

// How much of Elder Wren's voice has come back once a scene is unlocked: [percent, label]. The highest unlocked entry wins.
const WREN = {
  p0: [0, 'Silent: she speaks in chalk and with her bell'],
  r1: [15, 'One cracked word: “Hello”'],
  r2: [30, 'Whispers and chalk notes'], r3: [35, 'Whispers and chalk notes'], r4: [40, 'Whispers and chalk notes'], r5: [50, 'Whispers and chalk notes'],
  c6: [75, 'Full sentences again'], r6: [80, 'Full sentences, and a laugh'], r7: [85, 'Full sentences'], r8: [90, 'Full sentences'],
  c9: [95, 'Her full, clear voice'], r10: [100, 'Her voice rings across the valley'],
};

// Every scene in the order a pupil meets it.
export const SCENES = [
  { id: 'p0', act: 0, kind: 'prologue', level: 1, floor: 0, title: 'Prologue: ' + PROLOGUE.title, text: PROLOGUE.text },
  ...ACTS.flatMap((a) => {
    const base = { act: a.n, actTitle: a.title, zone: a.zone, level: a.n * 10, floor: a.n * 10 };
    const out = [
      { ...base, id: 'c' + a.n, kind: 'calling', title: 'The Calling', text: a.calling },
      { ...base, id: 'r' + a.n, kind: 'reckoning', title: 'The Reckoning', text: a.reckoning, ...(a.choice ? { choice: a.choice, after: a.after } : a.after ? { after: a.after } : {}) },
    ];
    if (a.n === 10) out.push({ ...base, id: 'e10', kind: 'epilogue', title: 'Epilogue: ' + EPILOGUE.title, text: EPILOGUE.text });
    return out;
  }),
];

const isCleared = (fk, n) => fk['n' + n] != null && (fk[n] || 0) >= fk['n' + n];
const unlocked = (s, level, fk) => level >= s.level && (s.floor === 0 || s.kind === 'calling' || isCleared(fk, s.floor));

// What a pupil is told about the story. `brief` (sent with every game state) carries no text, only what the village card needs.
// `full` adds the text of every unlocked scene and found note, and is only sent when the pupil opens or plays the story.
export function storyState(level, fk, on, full = false) {
  if (!on) return { on: false };
  const seen = new Set(Array.isArray(fk.sty) ? fk.sty : []);
  const have = SCENES.filter((s) => unlocked(s, level, fk));
  const locked = SCENES.find((s) => !unlocked(s, level, fk));
  const wren = have.reduce((best, s) => (WREN[s.id] && WREN[s.id][0] >= best[0] ? WREN[s.id] : best), WREN.p0);
  const reckonings = have.filter((s) => s.kind === 'reckoning').length;
  const next = !locked ? null : level < locked.level ? 'Reach Level ' + locked.level + ' to hear the next part of the story.' : 'Defeat the boss on Floor ' + locked.floor + ' to see what happens next.';
  const out = {
    on: true,
    have: have.length,
    total: SCENES.length,
    pending: have.filter((s) => !seen.has(s.id)).map((s) => ({ id: s.id, act: s.act, kind: s.kind })),
    next,
    done: !locked,
    wren: { pct: wren[0], label: wren[1] },
    parley: { pct: reckonings * 10, acts: reckonings },
  };
  if (full) {
    out.seen = [...seen];
    out.scenes = have.map((s) => ({ id: s.id, act: s.act, kind: s.kind, title: s.title, actTitle: s.actTitle || '', zone: s.zone || '', level: s.level, floor: s.floor, text: s.text, after: s.after || null, choice: s.choice || null, objective: s.kind === 'calling' ? { floor: s.floor, done: isCleared(fk, s.floor) } : null }));
    out.notes = NOTES.filter((n) => isCleared(fk, n.floor)).map((n) => ({ floor: n.floor, act: Math.ceil(n.floor / 10), boss: n.boss, text: n.text }));
  }
  return out;
}

// Record that a pupil has been shown some scenes. Only ids that are really unlocked are kept. Returns true if fk changed.
export function markSeen(level, fk, ids) {
  const ok = new Set(SCENES.filter((s) => unlocked(s, level, fk)).map((s) => s.id));
  const seen = new Set(Array.isArray(fk.sty) ? fk.sty : []);
  const before = seen.size;
  for (const id of Array.isArray(ids) ? ids : []) if (typeof id === 'string' && ok.has(id)) seen.add(id);
  if (seen.size === before) return false;
  fk.sty = SCENES.map((s) => s.id).filter((id) => seen.has(id));
  return true;
}
