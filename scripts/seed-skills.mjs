// Seed content for the v1.6 skills. Edit freely, then run `npm run seed:skills` to regenerate
// seed-skills.sql (the nine questions from the brief) and seed-skills-extra.sql (original extras to review).
// Every key is checked against the real marking code when the SQL is built, so a typo fails the build.
//
// Each entry: { seed, mode, skill, data }. `seed` is a stable id stored inside data, so running a seed file twice never adds a copy.
// min_floor / max_floor are left NULL: the question follows its skill's floor range (Game balance tab).
// Mode 4: options are listed in display order; `correct` = 1-based numbers of the right options; pick = how many pupils choose.
// Mode 5: accepted answers; words in (brackets) are optional; traps = words that, if kept, point at a specific mistake.
// Mode 6: wrong = the word that is wrong; fixes = accepted corrections.

const MC = 'MC_INFER';

// ---------------------------------------------------------------- the nine from the brief
export const CORE = [
  {
    seed: 'sk-core-1a', mode: 1, skill: 'speaker_lines',
    data: {
      correct: '“Did you tell Mei the bridge is closed?” asked Raj.\n“No, I never said that,” replied Tally.',
      prompt: '“Did you tell Mei the bridge is closed?” asked Raj. “No, I never said that,” replied Tally.',
      instruction: 'Give each speaker their own line.',
      lines: true,
    },
  },
  {
    seed: 'sk-core-1b', mode: 1, skill: 'action_beat',
    data: {
      correct: 'Mei looked at the clock. “We’re going to be late,” groaned Mei.',
      prompt: 'mei looked at the clock we’re going to be late groaned mei',
      beat: true,
    },
  },
  {
    seed: 'sk-core-2a', mode: 4, skill: 'verb_choice',
    data: {
      context: 'The Overlord’s guard barks an order.',
      stem: '“Open the gate!” said the guard. Which verb is the best upgrade for “said”?',
      options: ['whispered', 'bellowed', 'giggled', 'wondered'],
      correct: [2], pick: 1, code: 'MC_VERB',
      explanation: 'It’s an order, and orders are shouted. Bellowed shows the volume and the guard’s attitude.',
    },
  },
  {
    seed: 'sk-core-4a', mode: 5, skill: 'reported',
    data: {
      prompt: '“I am going to the Warren,” said Brisk.',
      instruction: 'Rewrite as reported speech.',
      kind: 'reported',
      accepted: ['Brisk said (that) she was going to the Warren.'],
      traps: [{ words: ['i', 'my', 'me'], code: 'RS_PRONOUN' }, { words: ['am', 'is', 'are'], code: 'RS_TENSE' }],
    },
  },
  {
    seed: 'sk-core-4b', mode: 5, skill: 'reported',
    data: {
      prompt: 'Wren told Quip that she would ring the bell the next day.',
      instruction: 'Rewrite as direct speech.',
      kind: 'direct',
      accepted: ['Wren said to Quip, “I will ring the bell tomorrow.”', 'Wren told Quip, “I will ring the bell tomorrow.”', 'Wren said to Quip, “I’ll ring the bell tomorrow.”', 'Wren told Quip, “I’ll ring the bell tomorrow.”'],
      traps: [{ words: ['she', 'her'], code: 'DS_PRONOUN' }, { words: ['would'], code: 'DS_TENSE' }, { words: ['next'], code: 'DS_TIME' }],
    },
  },
  {
    seed: 'sk-core-4c', mode: 6, skill: 'tense_fix',
    data: { sentence: 'The knight walked into the hall and sees a crown.', wrong: ['sees'], fixes: ['saw'] },
  },
  ...reading('sk-core-7', 'ilse-door', MC, {
    passage: '“I’m fine,” said Ilse, folding her arms.\nWren smiled gently. “You’ve been staring at that door for an hour.”\n“It’s just a door,” Ilse muttered, but she did not turn around.',
    a: { stem: 'How does Ilse really feel?', options: ['calm', 'worried but hiding it', 'bored', 'angry with Wren'], correct: [2], explanation: 'Her words say “fine”, but her folded arms, her long stare at the door and her refusal to turn around show she is worried and hiding it.' },
    b: { stem: 'Which TWO details show she isn’t “fine”?', options: ['folding her arms', 'staring at the door for an hour', 'muttered', 'did not turn around', 'Wren smiled', 'the door is mentioned'], correct: [1, 2, 3, 4], pick: 2, explanation: 'Folded arms, a long stare, a mutter and not turning around all show tension. Wren’s smile and the door being mentioned say nothing about how Ilse feels.' },
    c: { stem: 'Why does Wren smile gently?', options: ['to laugh at Ilse', 'because the door is funny', 'to show she understands and isn’t scolding', 'to tell Ilse to be quiet'], correct: [3], explanation: 'A gentle smile with kind words shows Wren understands. She is noticing, not telling Ilse off.' },
  }),
];

// ---------------------------------------------------------------- original extras (five per type) for you to review
const x = (n, mode, skill, data) => ({ seed: `sk-x-${n}`, mode, skill, data });
const lines = (n, correct) => x(`1a-${n}`, 1, 'speaker_lines', { correct, prompt: correct.replace(/\n/g, ' '), instruction: 'Give each speaker their own line.', lines: true });
const beat = (n, correct, prompt) => x(`1b-${n}`, 1, 'action_beat', { correct, prompt, beat: true });
const verb = (n, context, stem, options, key, explanation) => x(`2a-${n}`, 4, 'verb_choice', { context, stem: `${stem} Which verb is the best upgrade for “said”?`, options, correct: [key], pick: 1, code: 'MC_VERB', explanation });
const rep = (n, prompt, accepted, traps) => x(`4a-${n}`, 5, 'reported', { prompt, instruction: 'Rewrite as reported speech.', kind: 'reported', accepted, traps });
const dir = (n, prompt, accepted, traps) => x(`4b-${n}`, 5, 'reported', { prompt, instruction: 'Rewrite as direct speech.', kind: 'direct', accepted, traps });
const tense = (n, sentence, wrong, fix) => x(`4c-${n}`, 6, 'tense_fix', { sentence, wrong: [wrong], fixes: [fix] });

export const EXTRA = [
  // 1a: new speaker, new line (floors 11-20)
  lines(1, '“Is the library open today?” asked Noor.\n“Not until noon,” answered Chen.'),
  lines(2, '“Who left the lantern on the stairs?” demanded Hana.\n“It wasn’t me,” said Dan.'),
  lines(3, '“Can you carry this to the tower?” asked Mrs Tan.\n“Of course I can,” replied Kai.'),
  lines(4, '“Did the bell ring last night?” whispered Priya.\n“I heard nothing,” murmured Zack.'),
  lines(5, '“Where does this tunnel lead?” asked Lina.\n“Nobody has ever come back to tell us,” said Mr Lim.'),

  // 1b: action beat + speech tag (floors 11-20)
  beat(1, 'Raj tripped on the step. “Ouch, that hurt,” cried Raj.', 'raj tripped on the step ouch that hurt cried raj'),
  beat(2, 'Noor pushed open the heavy door. “It’s freezing in here,” shivered Noor.', 'noor pushed open the heavy door it’s freezing in here shivered noor'),
  beat(3, 'Chen stared at the empty shelf. “Someone took the map,” he muttered.', 'chen stared at the empty shelf someone took the map he muttered'),
  beat(4, 'Hana grabbed her torch. “Follow me,” she whispered.', 'hana grabbed her torch follow me she whispered'),
  beat(5, 'Dan folded the letter slowly. “This changes everything,” he said.', 'dan folded the letter slowly this changes everything he said'),

  // 2a: upgrade the verb, multiple choice (floors 21-30)
  verb(1, 'A frightened scout peers into a dark cave.', '“Is anyone there?” said the scout.', ['roared', 'chuckled', 'quavered', 'announced'], 3, 'The scout is scared, so the words come out shaky. Quavered shows fear in the voice.'),
  verb(2, 'Quip has just won the riddle contest.', '“I solved it!” said Quip.', ['sobbed', 'cheered', 'muttered', 'grumbled'], 2, 'Winning brings joy and a loud voice. Cheered shows both.'),
  verb(3, 'Tally is trying not to wake the sleeping dragon.', '“Don’t step on the twigs,” said Tally.', ['shrieked', 'boomed', 'sang', 'hissed'], 4, 'It has to be quiet but urgent. Hissed is a hushed, urgent whisper. Shrieked and boomed are far too loud.'),
  verb(4, 'Mei finds muddy footprints all over the clean floor.', '“Look at this mess!” said Mei.', ['scolded', 'pleaded', 'giggled', 'wondered'], 1, 'Mei is annoyed and telling someone off. Scolded fits that. Pleaded means begging, and giggled and wondered show the wrong feeling.'),
  verb(5, 'Raj needs a favour from the gate guard.', '“Please let us through,” said Raj.', ['commanded', 'bragged', 'begged', 'snapped'], 3, 'Raj is asking politely because he needs help. Begged shows how much he needs it.'),

  // 4a: direct to reported (floors 41-60)
  rep(1, '“I am hungry,” said Chen.', ['Chen said (that) he was hungry.'], [{ words: ['i', 'my', 'me'], code: 'RS_PRONOUN' }, { words: ['am', 'is', 'are'], code: 'RS_TENSE' }]),
  rep(2, '“I like this song,” said Noor.', ['Noor said (that) she liked this song.', 'Noor said (that) she liked that song.'], [{ words: ['i', 'my', 'me'], code: 'RS_PRONOUN' }, { words: ['like', 'likes'], code: 'RS_TENSE' }]),
  rep(3, '“I can see the tower,” said Kai.', ['Kai said (that) he could see the tower.'], [{ words: ['i', 'my', 'me'], code: 'RS_PRONOUN' }, { words: ['can'], code: 'RS_TENSE' }]),
  rep(4, '“I will find the key,” said Hana.', ['Hana said (that) she would find the key.'], [{ words: ['i', 'my', 'me'], code: 'RS_PRONOUN' }, { words: ['will'], code: 'RS_TENSE' }]),
  rep(5, '“I have lost my torch,” said Dan.', ['Dan said (that) he had lost his torch.'], [{ words: ['i', 'my', 'me'], code: 'RS_PRONOUN' }, { words: ['have'], code: 'RS_TENSE' }]),

  // 4b: reported to direct (floors 41-60)
  dir(1, 'Raj told Mei that he was feeling brave.', ['Raj said to Mei, “I am feeling brave.”', 'Raj told Mei, “I am feeling brave.”'], [{ words: ['he', 'him'], code: 'DS_PRONOUN' }, { words: ['was'], code: 'DS_TENSE' }]),
  dir(2, 'Tally said that she had found the map the day before.', ['Tally said, “I found the map yesterday.”'], [{ words: ['she', 'her'], code: 'DS_PRONOUN' }, { words: ['had'], code: 'DS_TENSE' }, { words: ['before'], code: 'DS_TIME' }]),
  dir(3, 'Chen told Hana that he would leave the next morning.', ['Chen said to Hana, “I will leave tomorrow morning.”', 'Chen told Hana, “I will leave tomorrow morning.”'], [{ words: ['he'], code: 'DS_PRONOUN' }, { words: ['would'], code: 'DS_TENSE' }, { words: ['next'], code: 'DS_TIME' }]),
  dir(4, 'Mrs Tan told the class that she was marking their books then.', ['Mrs Tan said to the class, “I am marking your books now.”', 'Mrs Tan told the class, “I am marking your books now.”'], [{ words: ['she', 'their'], code: 'DS_PRONOUN' }, { words: ['was'], code: 'DS_TENSE' }, { words: ['then'], code: 'DS_TIME' }]),
  dir(5, 'Kai told Priya that he would visit her the next week.', ['Kai said to Priya, “I will visit you next week.”', 'Kai told Priya, “I will visit you next week.”'], [{ words: ['he', 'her'], code: 'DS_PRONOUN' }, { words: ['would'], code: 'DS_TENSE' }]),

  // 4c: tense fix (floors 41-60)
  tense(1, 'The dragon roared and then flies over the village.', 'flies', 'flew'),
  tense(2, 'Mei opened the box and finds a silver key.', 'finds', 'found'),
  tense(3, 'Raj ran to the gate and shouts for help.', 'shouts', 'shouted'),
  tense(4, 'The guard blew his horn and every door slams shut.', 'slams', 'slammed'),
  tense(5, 'Tally climbed the tower and sees the whole valley.', 'sees', 'saw'),

  // 7a-c: reading between the lines (floors 81-90), five passages of three questions
  ...reading('sk-x-7-1', 'rb-quip', MC, {
    passage: '“It doesn’t bother me,” said Quip, kicking the loose stone.\nRaj raised an eyebrow. “You’ve kicked that stone twelve times.”\n“It’s just a stone,” Quip snapped, but he kicked it again.',
    a: { stem: 'How does Quip really feel?', options: ['relaxed and happy', 'sleepy', 'upset but pretending not to be', 'proud of Raj'], correct: [3], explanation: 'Quip says it doesn’t bother him, but the kicking and the snapping show he is upset and hiding it.' },
    b: { stem: 'Which TWO details show Quip is bothered?', options: ['kicking the loose stone', 'kicking it twelve times', 'snapped', 'kicked it again', 'Raj raised an eyebrow', 'a stone is mentioned'], correct: [1, 2, 3, 4], pick: 2, explanation: 'Kicking the stone, over and over, and snapping show Quip’s feelings. Raj’s eyebrow is Raj’s reaction, and the stone being mentioned is not a clue.' },
    c: { stem: 'Why does Raj raise an eyebrow?', options: ['to tell Quip to stop talking', 'because he is bored', 'to show he has noticed Quip isn’t really calm', 'because he is angry with the stone'], correct: [3], explanation: 'A raised eyebrow shows doubt. Raj has spotted that Quip’s actions don’t match his words.' },
  }),
  ...reading('sk-x-7-2', 'rb-hana', MC, {
    passage: '“I’m not nervous,” said Hana, tucking her hands under her arms.\nMr Lim smiled kindly. “Your voice is very quiet today.”\n“I’m just saving it,” Hana whispered, glancing at the stage.',
    a: { stem: 'How does Hana really feel?', options: ['confident', 'furious', 'bored', 'nervous but hiding it'], correct: [4], explanation: 'Her tucked-away hands, quiet voice and glances at the stage all show nerves, whatever she says.' },
    b: { stem: 'Which TWO details show Hana is nervous?', options: ['tucking her hands under her arms', 'her voice is very quiet', 'whispered', 'glancing at the stage', 'Mr Lim smiled', 'a stage is mentioned'], correct: [1, 2, 3, 4], pick: 2, explanation: 'Hiding her hands, a quiet voice, whispering and glancing at the stage are all signs of nerves. Mr Lim’s smile and the stage being mentioned are not.' },
    c: { stem: 'Why does Mr Lim smile kindly?', options: ['to laugh at her', 'to reassure her without embarrassing her', 'because she is late', 'to tell her to be quiet'], correct: [2], explanation: 'A kind smile with a gentle comment shows he has noticed and wants to put her at ease.' },
  }),
  ...reading('sk-x-7-3', 'rb-tally', MC, {
    passage: '“I don’t need any help,” said Tally, wobbling under the large crate.\nMei stepped forward. “Your legs are shaking.”\n“They’re just cold,” Tally gasped, but she let Mei take one end.',
    a: { stem: 'How does Tally really feel about carrying the crate?', options: ['it is easy for her', 'it is fun', 'it is too much for her but she won’t admit it', 'it is boring'], correct: [3], explanation: 'She says she needs no help, but she wobbles, shakes and gasps. She is struggling.' },
    b: { stem: 'Which TWO details show Tally needs help?', options: ['wobbling', 'her legs are shaking', 'gasped', 'let Mei take one end', 'Mei stepped forward', 'the crate is mentioned'], correct: [1, 2, 3, 4], pick: 2, explanation: 'Wobbling, shaking legs, gasping and handing over one end all show she is struggling. Mei stepping forward is Mei’s action, and the crate being mentioned is not a clue.' },
    c: { stem: 'Why does Tally let Mei take one end?', options: ['she wants to race', 'Mei forced her', 'she has quietly accepted that she needs help', 'she wants to drop it'], correct: [3], explanation: 'The word “but” shows a change. Tally still makes an excuse, but her actions admit she needs help.' },
  }),
  ...reading('sk-x-7-4', 'rb-chen', MC, {
    passage: '“I don’t mind if you go without me,” said Chen, staring at his shoes.\nNoor tilted her head. “You’ve said that three times.”\n“Go on, have fun,” Chen mumbled, and he sighed.',
    a: { stem: 'How does Chen really feel about being left behind?', options: ['delighted', 'relaxed', 'curious', 'hurt and left out'], correct: [4], explanation: 'His words say he doesn’t mind, but staring at his shoes, mumbling and sighing show he is hurt.' },
    b: { stem: 'Which TWO details show Chen minds being left behind?', options: ['staring at his shoes', 'he says it three times', 'mumbled', 'sighed', 'Noor tilted her head', 'Chen speaks to Noor'], correct: [1, 2, 3, 4], pick: 2, explanation: 'Looking down, repeating himself, mumbling and sighing show his real feelings. Noor’s head tilt is her reaction, and who he speaks to tells us nothing.' },
    c: { stem: 'Why does Noor tilt her head?', options: ['she is about to sneeze', 'she doesn’t quite believe him and is gently checking', 'she is listening for a noise', 'she wants to leave'], correct: [2], explanation: 'A tilted head shows curiosity and doubt. Noor notices his words don’t match his mood.' },
  }),
  ...reading('sk-x-7-5', 'rb-brisk', MC, {
    passage: '“It’s only a game,” said Brisk, but she gripped the board tightly.\nWren grinned. “Then why are your knuckles white?”\n“Be quiet,” Brisk muttered, and she moved her piece with a shaking hand.',
    a: { stem: 'How does Brisk really feel about the game?', options: ['it matters a lot to her', 'she doesn’t care', 'she is bored', 'she is sleepy'], correct: [1], explanation: 'She says it’s only a game, but the tight grip, white knuckles and shaking hand show it matters to her.' },
    b: { stem: 'Which TWO details show the game matters to Brisk?', options: ['gripped the board tightly', 'her knuckles are white', 'muttered', 'a shaking hand', 'Wren grinned', 'a board game is mentioned'], correct: [1, 2, 3, 4], pick: 2, explanation: 'Gripping, white knuckles, muttering and a shaking hand all show strong feeling. Wren’s grin is his reaction, and a board game being mentioned is not a clue.' },
    c: { stem: 'Why does Wren grin?', options: ['he is losing', 'he is angry', 'to tease her gently because he has spotted that she cares', 'he wants to cheat'], correct: [3], explanation: 'A grin and a teasing question show Wren has noticed her real feelings and is playfully pointing them out.' },
  }),
];

// Three Mode 4 questions about one passage. They share a group id, so the selector serves them back to back.
function reading(seed, group, code, { passage, a, b, c }) {
  const mk = (letter, q) => ({ seed: `${seed}${letter}`, mode: 4, skill: 'reading_between', data: { passage, stem: q.stem, options: q.options, correct: q.correct, pick: q.pick || 1, explanation: q.explanation, group, code } });
  return [mk('a', a), mk('b', b), mk('c', c)];
}
