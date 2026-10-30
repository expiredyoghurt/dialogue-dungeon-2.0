# Dialogue Dungeon v2.0

Arcade-RPG dialogue-writing practice on Cloudflare Workers + D1 + Durable Objects.

## What is new in v2.0 (fewer clicks, less scrolling)

Front-end only (`public/index.html`); the server and database are unchanged.

- **Fight screen:** the arena shrinks on short screens and carries both HP bars; the two strike timers sit side by side as thin bars; Drink / Flee / Rules / Feedback are one compact toolbar at the top; the question is scrolled into view when it appears; the submit button stays pinned to the bottom of the question card. "Reduce motion" now lives in the Help dialog and is remembered.
- **Profile:** a sticky Back button at the top, ▲/▼ markers in the gear dropdowns, a one-tap "Equip best gear" (best weapon by damage, best armour by defence), and collapsible "Next jobs" (open when a job point is waiting) and "Rules to practise".
- **Shop:** owned gear that is not equipped gets an "Equip" button right in the shop.
- **Victory / defeat:** the main button (Take the stairs down / Fight on / Try this floor again) is at the top and has keyboard focus, so Enter works; loot that beats current gear has an Equip button; the defeat screen can retry the same floor.

## What is new in v1.10 (village screen)

- The pupil's starting page is now: character box (with tabs) → Guild Training Grounds prompt (only when there is an assignment or bonus) → a big "Descend the dungeon" box.
- Dungeon Dive, the Adventurer shop, The Hush and Feedback are tabs on the character box (click a tab again to close it). The Hush tab shows how many new story parts are waiting.
- (v1.10.1) The shop tab groups items under Melee, Ranged, Magic, Accessories and Potions (armour sits with its class; starter gear with no class sits under Melee). By default it hides items from shop levels below the pupil's current one and gear from other classes, showing only what suits the active job's whole path; "Show all items" reveals the rest. Front-end only: the server still sells everything the pupil can use.
- The story is now strictly in order on the server (`openScenes` in `src/story.js`): a scene opens only when every scene before it is open, so "The story so far..." can never show an act the pupil has not reached by clearing the previous boss floor. Mid-boss notes stay hidden until their act has started.

## What is new in v1.9.x (teacher accounts)
(v1.9.1: the teacher console no longer waits on the server to draw itself after a reload, and shows the real error if something fails instead of sitting on "Loading…".)

The teacher console now has two kinds of sign-in.

- **Admin (superadmin).** The existing `teacher_user` / `teacher_password` secrets. Nothing changes for you: you still see everything. You also get a new **Teachers** tab.
- **Teacher accounts.** Made by the admin in *Teachers → Add a teacher* (name, username, a suggested or typed password of 8+ characters; shown once). A teacher signs in at the same teacher sign-in page with their own username and password. They can change their own password from the top bar.

**What a teacher can do:** create and manage *their own* classes (class codes, pupils, sign-in cards, archive, delete), see Analytics, Diagnosis, assigned practice, Feedback and Pupil stats **for their own classes only**, and add, edit and remove questions **for their own classes**. They can see the shared question bank (read only). Another teacher's classes, pupils, results and feedback are never visible, and the server refuses requests for them.

**What stays with the admin:** the Verb bank, Game balance, questions shared by every class, guest players' results, and the Teachers tab. The admin can move a class from one teacher to another (Classes & pupils → open a class → Owner), and can create a class for a teacher.

**Switching off or deleting a teacher.** *Switch off* signs them out at once and blocks sign-in; their classes are untouched. *New password* also signs them out. *Delete* removes the account; their classes and pupils are kept and go back to the admin. Pupils are never affected by any of this: they still sign in with their username and the class code.

**Database.** A `teachers` table and a `classes.teacher_id` column. The app adds them by itself the first time anyone signs in to the teacher console, so **no migration step is needed**. Existing classes belong to the admin (`teacher_id` NULL). `schema.sql` includes them for new databases, and `migrate-v1.9.sql` is there if you would rather run the change by hand (once only, and not on a database that already has it). Teacher passwords are stored salted and hashed (PBKDF2-SHA256), never in plain text.

**Tests.** `test/accounts.test.mjs` runs the real routes against the real schema (needs Node 22+ for `node:sqlite`) and checks that a teacher cannot read or change anything that is not theirs.

## What is new in v1.8.1 (training monsters match the pupil)
A training monster is now **as strong as the pupil: their level, but never above level 20**. It no longer depends on how far the pupil has got in the dungeon, or on the warm-up / stretch / challenge step (those labels now only describe how hard the question is). The monster's level is shown on its card (for example "Training Slime · Lv 12"), and its XP is the dungeon formula for a monster of that level times the training multiplier, so a level 20-or-higher pupil always meets level 20 monsters. The monster is fixed at the level the pupil had when they started answering it; the next one matches any new level. The cap is a setting (*Game balance → Guild Training Grounds → Highest training monster level*, default 20). No database change: upgrade from v1.8.0 by deploying. Tests: 210.

## What is new in v1.8.0 (better feedback, the Guild Training Grounds, class diagnosis)

**1. Feedback after a wrong answer teaches instead of telling.** Hints now climb with each try (`src/hints.js`):
- *Try 1:* the trouble spots are marked in the pupil's own answer (a wavy underline, or a ▾ where something is missing, with screen-reader text), "You fixed 7 of 9 spots", and the rule tips. The exact fix is not sent yet.
- *Try 2:* adds what is wrong at each spot, and a right-versus-wrong example of that kind of mistake (36 mistake types have one).
- *Last try or "Show answer":* adds exactly what to change, the model answer, and a next step ("train this skill at the Guild Training Grounds").
It works in Modes 1, 4, 5 and 6, in solo fights, Dungeon Dive and the Training Grounds. The server enforces it: early responses simply don't contain the fix.

**2. The Guild Training Grounds** (a button in the village; the pupils' practice room). A pupil picks one of the 13 skills and sees a worked example, then 3-8 *training monsters* with questions that climb from easy to hard. A missed monster comes back once at the end. Every skill shows the pupil's mastery: ○ not started, ◔ learning, ◑ getting there, ● secure (at least 5 of the last 8 first tries right with no mistake of that kind). The page also shows "Recommended for you" and anything the teacher assigned.
- Training monsters (from v1.8.1: as strong as the pupil, never above level 20) pay **1.5×** the XP of a dungeon monster of their level, using the same formula as the dungeon, so gear and job XP bonuses and the gentle start still apply. Later tries pay less, as everywhere. They give **no gold and no drops**, cost no HP, and don't count as dungeon kills or move the dungeon forward.
- **Double XP the first time each of the pupil's weakest three skills is trained each day.** The three are fixed when the pupil first opens the Training Grounds that day (so improving a weakness doesn't summon a new one), and the bonus covers the monsters of that first round on each. "Weakest" ranks a skill with no attempts between one answered badly and one answered well.
- A daily cap (default 30 monsters pay XP; more can still be practised) stops XP farming. A "day" follows the time zone setting (default UTC+8).
- Teacher settings in *Game balance → Guild Training Grounds*: XP multiplier (1.5), daily bonus multiplier (2), how many weakest skills get it (3), monsters per day (30), time zone (8), highest training monster level (20, from v1.8.1).

**3. Teacher diagnosis** (new *Diagnosis* tab):
- **Teach next:** the skills the class needs most, with the share of tries that had a mistake, how many pupils are struggling (a mistake of that kind on 40% or more of at least 3 first tries), the trend against the previous period, and a suggested action (reteach to the class / small-group support / mostly secure).
- **All skills** table, **Who needs support** (pupil × skill mastery grid), and **What pupils actually wrote**: the most common wrong answers to the hardest questions, so you see the misconception, not only the score.
- **Assign practice:** to the whole class or chosen pupils, with a target number of first-try-correct training answers and an optional due date. Pupils see it on their village screen and in the Training Grounds; you see how many have finished. One click from "Teach next" assigns it.
- CSV export of the skills table and of the pupil grid.

**How it works underneath.** Every question now records which rules it exercises (`questions.rules`, a bit mask worked out from the question's own key). New and edited questions are analysed as they are saved; your existing questions are analysed automatically (a bounded batch the first time a pupil opens the Training Grounds or you open Diagnosis, or all at once with *Re-analyse questions*). Nothing is changed in your questions.

**Upgrading (back up first).** v1.8 adds a column and two tables:
```
npx wrangler d1 export dialogue-dungeon --remote --output=backup-before-v1.8.sql
# from v1.5 or older, first: npx wrangler d1 execute dialogue-dungeon --remote --file=./migrate-v1.6.sql
npx wrangler d1 execute dialogue-dungeon --remote --file=./migrate-v1.8.sql   # once only
npx wrangler d1 execute dialogue-dungeon --remote --file=./seed-skills.sql    # no-op if you already seeded; needs the v1.8 column
npx wrangler deploy
```
`--local` for the local database. A database created from this version's `schema.sql` already has everything: don't run the migrations on it. The seed files now also fill the new column.

**Tests.** 207 (`test/practice.test.mjs` adds 38). One older test (`basic attacks cannot finish a monster…`) failed about a third of the time because it let the monster randomly dodge a basic attack; it now switches monster dodge off, so it is deterministic.

## What is new in v1.7.0 (the two v1.6 branches merged)
v1.7.0 combines the two versions that were built side by side from v1.5.1: **branch A** (player HP scaling, dodge, monster dodge, sure hit) and **branch B** (six question skills and nine new question types). Both are described below. Nothing in either was removed or changed in behaviour.
- **Where they meet.** The saved game-balance config now holds both sets of settings; saving from the teacher console keeps all of it. Configs saved by either branch load cleanly into v1.7.0: a config from branch A gets the default question skills (all on, 35%), and one from branch B gets the default dodge perks once (the same rule branch A already used for pre-v1.6 configs). A fight on a skill floor has dodge, sure hit and player HP exactly as on any other floor.
- **Game balance tab** now lists, in order: Monster HP, Player HP, Dodge, Monster dodge chance, Sure hit, Question skills, and the rest.
- **Database.** Only branch B changes the schema. If your database predates v1.6, run `migrate-v1.6.sql` once (commands in the branch B section). Branch A needs no migration. If you already deployed one of the branches, see the upgrade notes in the release message.
- **Tests.** 169 at the time of the merge (95 from v1.5.1, 22 for branch A, 48 for branch B, 4 new in `test/merge.test.mjs`).

## v1.6 branch A: player HP scaling, dodge and sure hit (shipped inside v1.7.0)
- **Player HP** (teacher console, Game balance tab, new section under Monster HP). A pupil has 10 HP at level 1 and each level adds HP by tier. A tier can list several HP amounts with chances. Defaults: levels 2-10 +1; 11-30 +2; 31-50 +2 (25%) or +3 (75%); 51-70 +2 (25%), +3 (50%), +4 (25%); 71-100 +3 (15%), +4 (25%), +5 (35%), +6 (25%). Levels past the last tier use the last tier. Chances are relative weights.
- **Rolls are fixed per pupil and level** (a hash of the pupil's id and the level, `hpGain()` in `src/gamedata.js`), so max HP never changes between visits, Dive teammates agree, and there is **no database migration**. A level-up heals the HP it adds and the victory screen shows "+N max HP". The teacher preview shows the average and the lowest/highest possible max HP.
- **Existing pupils** get the new max HP straight away (a level 30 pupil goes from 39 to 59 HP). Their current HP is unchanged until they heal or return to the village.
- **Dodge** (new section). Chance a monster's attack misses and does 0 damage: levels 1-10 1%, 11-30 2%, 31-50 3%, 51-70 4%, 71-100 5% (editable tiers). Dodge is rolled before parry; a dodged hit cannot be reflected. Pupils see "Dodged!", Dive logs it, and the village shows Dodge among combat stats.
- **Dodge classes** (new "Dodge chance %" column in the job perks table): Scout +5%, Horse Archer +5%, Ranger 10% in total, Bow Knight 10% in total, Assassin +15%. Ranger and Bow Knight keep the Horse Archer's 5% like their other perks, so their own entry is 5%. Total dodge (level plus class) is capped at 50%.
- **Monster dodge** (Game balance tab, "Monster dodge chance"): a pupil's regular attack misses and deals 0 with 5% chance against regular monsters and 10% against mid-bosses and bosses (editable). Correct-answer strikes and reflected damage never miss. A miss has no crit, stun or leech. Pupils see "💨 Dodged!" on the monster; Dive logs it.
- **Sure hit** (Game balance tab, "Sure hit"): tick any job or monster. A sure-hit job's regular attacks ignore monster dodge; a sure-hit monster's attacks ignore pupil dodge (parry and reflect still apply). Default: Sniper only, no monsters. Pupils with it see "Sure hit" in the village stats.
- Configs saved before v1.6 get the five dodge perks added once; a config saved from v1.6 is taken as it is.
- 117 tests (22 new, `test/hpdodge.test.mjs`).

## What is in v1.0.0
v1.0.0 = v0.16.1 (hidden job tree, instruction and rules scaffolding) + v0.17 (Dungeon Dive co-op parties on Durable Objects).

- **Job tree is revealed step by step.** The server only sends the jobs a pupil owns plus the jobs they can unlock next (children of an owned job). Names, damage and perks of everything deeper never reach the browser (`visibleJobs()` in `src/game.js`). The teacher console still shows the full tree. In a Dungeon Dive lobby, teammates' current job names are sent so the party list reads properly (`jobName` in `src/dive.js`).
- **Instruction and scaffolding.** A Help dialog (How to play / Question types / The rules) opens from the login page, the village, solo fights and Dungeon Dive fights; a dismissible "New here?" card shows until it is first opened. Each question has a collapsible "Rules to remember" box, wrong answers show the specific rules broken (with coloured examples, as in Dialogue Dash), and the profile shows the pupil's three most-missed rules from `/api/me`. The How to play tab gains a Dungeon Dive step when a teacher has switched Dive on.
- **Dungeon Dive (co-op).** One `DiveParty` Durable Object per party (4-character code, up to 4 pupils). Off by default: a teacher turns it on under Game balance.

## v1.6 branch B: question skills, nine new question types (shipped inside v1.7.0)

Six **skills** are families of questions tied to story zones by floor. On a floor inside a skill's range, that skill supplies about its share of the questions (default 35%) and the rest come from the ordinary pool exactly as before. In Dungeon Dive the monster's level stands in for the floor, and the same selector is used.

| Skill | Floors | Question | Mode |
|---|---|---|---|
| New speaker, new line | 11-20 | 1a: give each speaker their own line | 1 (`lines: true`) |
| Action beat + speech tag | 11-20 | 1b: action beat takes a full stop, not a comma | 1 (`beat: true`) |
| Upgrade the verb (multiple choice) | 21-30 | 2a | 4 |
| Direct and reported speech | 41-60 | 4a direct to reported, 4b reported to direct | 5 |
| Tense fix | 41-60 | 4c: tap the wrong word, type the fix | 6 |
| Reading between the lines | 81-90 | 7a-c: one passage, three questions served back to back | 4 |

- **New modes.** Mode 4 = multiple choice (pick 1 or pick N, two tries: a wrong pick is greyed out, a second miss shows the answer and why, no credit). Mode 5 = free-text transform (case, spacing, quote style, trailing punctuation and contractions are ignored; `(that)` in an accepted answer is optional). Mode 6 = tap the wrong word, then type the fix (wrong words and fixes are lists). Modes 1, 5 and 6 keep three tries. XP: Modes 1, 5, 6 pay 10 / 6 / 3, Mode 4 pays 8 / 4.
- **Mode 1 flags.** `lines: true` makes line breaks count (new code `NO_NEW_LINE`, and `EXTRA_NEW_LINE` for a break inside one speaker's speech). `beat: true` marks a sentence that ends with an action beat before the speech: a comma there gets `BEAT_COMMA`, and the "comma after a saying verb" rule does not fire.
- **Feedback.** Rules 8-13 and 16 new feedback codes in `src/rules.js`, with the Quip tips. They show in each pupil's "Rules to practise" and in the teacher heatmap.
- **No answer leakage.** Payloads sent to the browser never contain correct ids, accepted answers, traps, explanations or the wrong word. The server counts Mode 4 and Mode 6 tries itself.
- **Teacher console.** Game balance gets a *Question skills* table (on/off, share %, first and last floor per skill). The Questions tab has authoring forms with live previews for every mode, a skill choice and optional per-question floors, and Analytics shows accuracy by skill.
- **Database.** `questions` gains `skill`, `min_floor`, `max_floor` (all NULL for existing questions = ordinary pool, any floor). **Upgrading an existing database (from v1.5.1 or branch A):** back it up, then run `migrate-v1.6.sql` once, then `seed-skills.sql` (see the commands below). A fresh install uses `schema.sql`, which already has the columns, and `db:init:*` also loads `seed-skills.sql`.
- **Seed files.** `seed-skills.sql` holds the nine questions from the brief; `seed-skills-extra.sql` holds 45 original extras (5 per type; the reading type as 5 passages of 3 questions) to review. Both are INSERT-only and safe to run again (a `seed` id inside each question stops duplicates, and a question you removed is never brought back). Edit `scripts/seed-skills.mjs` and run `npm run seed:skills` to regenerate them; every key is checked against the real marking code when they are built.

```
# 1. back up (remote)
npx wrangler d1 export dialogue-dungeon --remote --output=backup-before-v1.6.sql
# 2. add the columns (once only)
npx wrangler d1 execute dialogue-dungeon --remote --file=./migrate-v1.6.sql
# 3. add the nine questions, then (optionally) the extras
npx wrangler d1 execute dialogue-dungeon --remote --file=./seed-skills.sql
npx wrangler d1 execute dialogue-dungeon --remote --file=./seed-skills-extra.sql
# 4. deploy
npx wrangler deploy
```
Use `--local` instead of `--remote` for the local database. Do not run `migrate-v1.6.sql` on a database that was created from this version's `schema.sql`: the columns already exist.

## What is new in v1.5.0 (job tiers, gear styles, shared combat rules)
**Step 1: one set of combat rules, and a balance script**
- `src/combat.js` holds the combat rules (critical hits, parry, reflect, stun, leech, the caps). Solo play (`sim()` in `src/game.js`) and Dungeon Dive (`simParty()` in `src/dive.js`) both call it, so they cannot drift apart. A build without the special stats draws no extra random numbers.
- `npm run balance -- --job fighter --level 40 --mlevel 40 --armor plate` runs the **real** solo combat a few hundred times per piece of gear and prints max hit, swing time, answer strike, a DPS index, kill time, damage taken and win rate. Options: `--slot weapon|armor|acc`, `--weapon/--armor/--acc id`, `--mob id`, `--answer`, `--runs N`. Seeded, so results repeat. The swift and heavy styles below were tuned with it.
- The **answer strike no longer depends on a weapon's style**: it is built on the weapon's balanced value (`pw`), so a swift or heavy weapon never changes what a correct answer is worth.

**Step 2: more job tiers (data), and gear that uses the stats that already existed**
- Seven new jobs, **30 in all**: **Novice** (Villager → Novice → Adventurer), **Squire / Scout / Initiate** (between Adventurer and Fighter / Archer / Acolyte), **Soldier / Marksman / Adept** (between those lines and the six middle classes). A full path to a top job is now seven unlocks.
- **Job points** at levels 5, 10, 15, 20, 30, 40, 60, then every 20 (`points()` in `src/gamedata.js`). The profile shows the next point. Shop levels are unchanged (each new job sits at the shop level of the step before it); the shop level, perk inheritance and ranged jobs are now explicit per job instead of counted by depth.
- **Existing pupils are completed on load**: anyone who owns a job also gets the jobs now before it, keeps their active job, and keeps spending points as before. Pupils on a single line never lose a point. A pupil who had spread across several lines may have fewer free points than before until their next point (it is clamped at 0, nothing is taken away). Saved configs from before v1.5 still give the new jobs their default perks. No database migration.
- The hidden job tree still reveals only the next step, so Squire shows before Fighter, and so on.
- **The seven new jobs have their own sprites** (v1.5.1: `public/p/novice.png` and so on, cut out of the supplied sheet at the same height as the others). A job without a PNG can borrow another job's sprite through `SPR` near the top of `public/index.html`.
- **Class sub-line gear** (the shop and drops use the existing `fam` tag, which can name any job): heavy mauls (Fighter line), parrying rapiers (Swordsman line), swift knuckles (Brawler), swift short bows (Horse Archer), heavy crossbows (Longbowman), swift wands (Mage), stun maces (Cleric) and leech staves (Acolyte line), each in three tiers at shop levels 3 and 4. Armour in four styles: Bulwark plate (heavy, slower), Thornmail (reflect), Skirmisher leathers (parry, faster) and Mirror robes (reflect). Accessories: Eagle Ring, Duelist Badge, Thunder Charm in the shop; Mirror Pendant, Vampire Fang and Lucky Die only from bosses (4% each). 42 new items in all.
- Weapon styles are a trade, not an upgrade: **swift** = about half the damage, 30% faster, 12% critical hits; **heavy** = about double the maximum hit at half speed. Teachers can edit every number in the items table.

**Step 3: new combat stats**
- **Critical hits** (`dbl`, now on gear as well as on job perks), **parry** (a monster's hit does nothing), **reflect** (half the damage you take, at least 1, bounces back), **stun** (a hit delays the monster's next strike by 4 seconds), **leech** (a share of the damage you deal comes back as HP) and **answer crit** (`crit`, a double answer strike) can sit on any weapon, armour or accessory, and armour can carry attack speed.
- Totals (gear plus job perk) are capped so no build is unkillable: critical hits and answer crit 50%, parry and reflect 40%, stun 30%, leech 20%.
- **A reflect or a parry never skips the "needs correct answers" rule**: a reflected hit cannot finish a monster that still needs an answer. In Dungeon Dive a reflect that finishes a monster counts as a kill like any other.
- Job perks added: Knight and Monk parry 10%, Paladin reflect 15%, Battle Mage reflect 10%, Brawler stun 10%, Berserker leech 10%, Marksman critical hits 5%. Jobs with a saved perk list keep it: a teacher can reset them in the perks table.
- Pupil screens: item descriptions list the new stats; the village shows the pupil's combat stats; fights show Parried, reflect, Stunned and leech pop-ups; Dungeon Dive logs them. Teacher console: seven new columns in the items table, all editable.
- 94 tests (19 new).

## What is new in v1.4.0 (The Hush: story mode)
A narrative that puts pupils in the world of Parley and gives them a reason to go down. They are apprentice Voice-bearers whose correctly written dialogue still rings true, and only true speech can hurt the Hollowed.
- **Ten acts, two scenes each** (about 80 words or fewer, P3 to P6 reading level, British spelling). The **Calling** plays in the village when a pupil reaches Level 10, 20 … 100 and points to the next boss floor. The **Reckoning** plays on the victory screen after the boss on Floor 10, 20 … 100 (the Act 10 Reckoning is a seal-or-mend choice, and both paths end with Mend). A **prologue** plays on a pupil's first visit so the premise is there from Level 1, and an **epilogue** after Floor 100 leaves the story open (a staircase to Floor 101, a letter from another silent village).
- **Order is protected.** A Reckoning needs both the cleared boss floor *and* the matching level, so it never plays before its Calling. A pupil who dives fast waits for the level; a pupil who levels without descending sees only Callings, each with a "reach Floor N" objective. If the Calling arrives after the boss is already beaten, both play together, with the Reckoning marked "looking back".
- **Mid-boss notes** on floors 5, 15 … 95 show as a found-note card on the victory screen.
- **Village "The Hush" card:** a "Voices restored" bar for Elder Wren and for Parley, the next objective, and the **📖 The story so far...** button. It lists every unlocked part by act and ends with "Continue through the dungeon to unlock more."
- **In-world rules:** the fight screen says steel alone can't finish a Hollowed creature (the must-answer rule); a defeat says "The Hush takes what you carry, never what you've learned"; respawn is "the Hollow knits itself shut behind you"; Dungeon Dive is a Chorus; Quip the lantern-sprite gives the hints. From Floor 60 the bosses show as Echoes ("Echo of the Mimic Emperor" …) and Floor 100 is **The Hushbinder** (still the Lich King sprite).
- **Teacher switch:** Game balance tab, "Story: The Hush". Off hides every scene, the card and the Echo names. Pupils' progress is kept while it is off.
- **No database migration.** What is unlocked is worked out from level and cleared floors. Which scenes a pupil has been shown is stored in their existing `floor_kills` JSON (`sty`). Scene text only leaves the server once unlocked (`POST /api/game/story`), like the job tree. 75 tests.
- **Pupil stats tab (beta testing):** teacher console, "Pupil stats". Lists every pupil (class, level, XP, HP, gold, job, floors cleared, kills, last seen), filter by class or search, CSV download. **Edit** changes level, XP, HP, gold, gold in pack, kills, floors cleared, shop level, active job and unlocked jobs, equipped gear and the bag, and can replay a pupil's story or reset them to a new player. Saving ends any fight in progress. Behind the normal teacher sign-in only (no second password). Code: `src/players.js`, routes `/api/t/players`. Edits are validated (XP below the level's need, jobs need their parent job, gear must fit the slot and job) and logged to the Worker log.
- **Files:** `src/story.js` (all the text, unlock rules, boss names), `public/story.js` (pupil screens), small hooks in `src/game.js`, `src/gamedata.js`, `public/index.html` and `public/teacher.js`.
- **To expand:** add an act to `ACTS` in `src/story.js` (level and floor are 10 × the act), raise `TOP_FLOOR`, and add notes to `NOTES`. Open threads: the Deep Verse (Floor 101+), other silent villages, the Hushbinder's origin, new classes or skills sent out by the mended Chorus, and Ilse and the Archivist's redemption.

## What is new in v1.3.0 (pupil feedback)
- **💬 Feedback button** for pupils in the village, in solo fights and in Dungeon Dive. A pupil picks Difficulty / Idea / Problem / Other, optionally rates the difficulty (too easy / about right / too hard) and writes up to 600 characters.
- **Teacher console, new Feedback tab:** newest first, filter by New / Done and by type, shows the pupil's name and class plus the context the server recorded (level, job, and floor and monster if they were mid-fight). Mark done / reopen, delete, or clear everything marked done. Difficulty ratings are totalled at the top.
- Limits: 5 notes per pupil per hour and 15 per day. Guests can send feedback too. Pupils can't see anyone else's feedback.
- New `feedback` table, created automatically on first use (also added to `game-schema.sql`), so **no migration step** is needed. `src/feedback.js` holds the code. 57 tests.

## What is new in v1.2.0 (XP mode)
- **XP mode toggle** (teacher console, Game balance tab, "XP mode"). *Fixed XP by monster level* (default, unchanged): XP = monster XP × level. *Monster-level XP + 50% of strike damage*: that, plus half of the damage the pupil's answer strikes took off the monster. Basic attacks don't count, and damage is what the strike actually removed (no overkill; the 1-HP "needs more correct answers" save isn't counted). Item/job XP bonuses and the gentle-start multiplier apply to the total.
- **Dungeon Dive:** the base XP from the kill is still shared equally; the strike-damage part is each pupil's own (50% of the damage their own strikes dealt). XP bonuses and the balanced-party bonus apply to each pupil's total.
- Stored as `xpMode` in the saved config (`'level'` | `'damage'`); older saved configs default to `'level'`. No database migration. 53 tests.

## What is new in v1.1.0 (Dungeon Dive balance, Game balance tab)
- **Scale monster HP with party size** toggle. Off: a monster has the same HP whatever the party size (the "extra player adds × HP" number is then ignored). On by default, as before.
- **Mid-bosses and bosses in Dungeon Dive** toggle, off by default. On: every 20th monster is a mid-boss and every 40th a boss (both numbers editable, 0 turns that kind off, a boss wins a clash). They use the solo mid-boss / boss HP, damage, rage and correct-answer settings, their own drop tables, and are picked by level like the floor leads. Pupils see ⭐ / 👑 labels and a "boss is coming" warning.
- **Dungeon Dive drop multiplier** (default ×1, 0 = no drops, max ×20). Each item's chance is capped at 10% first, then multiplied (never above 100%).
- 50 tests (6 new).

## Deploying
1. `npm install`, then `npm test` (210 tests).
2. `npx wrangler deploy`. The first deploy of v1.0.0 runs the Durable Object migration `v1` (`new_sqlite_classes: ["DiveParty"]`) automatically. Keep `wrangler.jsonc` and `wrangler.test.jsonc` as shipped.
3. Teacher console, Game balance tab, Dungeon Dive: tick **Turn on Dungeon Dive**. Until then pupils do not see the Dive card.

## Where things live
- `src/game.js` solo game, state builder, `visibleJobs()`; `src/dive.js` party mode and the `DiveParty` class; `src/gamedata.js` items, jobs, perks, balance defaults; `src/rules.js` the dialogue rules (1-7) and the v1.6 skill rules (8-13); `src/skills.js` skill definitions and the marking for Modes 4-6; `src/select.js` floor- and skill-aware question selection shared by solo play and Dungeon Dive.
- `public/index.html` pupil app; `public/story.js` story screens (loaded by index.html); `src/story.js` story text and unlock rules; `public/teacher.js` teacher console.
