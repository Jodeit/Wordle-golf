// Par for every answer, measured rather than guessed.
//
// Par used to come from counting letters: a word built from opener letters
// played short. That could not see the traps. BRIDE is all common letters and
// rates easy that way, but a standard opener leaves you staring at BRIDE and
// PRIDE with no way to tell them apart — a stroke gone. The worst of them are
// the -IVER and -OVER families, where only the first letter moves.
//
// Instead, a solver plays every answer from three standard openers (STARE,
// CRANE, SLATE), choosing sensibly and paying the real cost when candidates
// are indistinguishable. The average is that word's expected strokes, and par
// follows: under 3.02 plays short, over 3.7 plays long, and the bulk of
// ordinary words are par 4s — which is how the pool actually feels.
//
// Regenerate with test/build-pars.mjs if the answer pool ever changes.

const PAR_3 = `
abuse actor acute agent agree alert alone angle angry argue arise aside asset bases basic
basil beach black blast bless blues blush bonus cable camel canoe carve cause chain chalk
charm chart chase cheat chess chest china clash class clean clerk cloak close cloth coast
cobra court crane crate crest dance dealt death decay dress dusty earth elect elite entry
essay exact exams false flash flesh flush fresh giant glass harsh heart heavy hotel jeans
lance large laser learn lease least loser marsh meant minus naive nasty ocean panel party
pasta pause peach plant plate press raise ranch range reach react ready realm roast sadly
saint salad salon sandy sauce scale scarf scene scent score scrap screw scrub shaft shall
shark sharp siren skate slate slept sling small smart snack sneak spark speak spear spend
spent spite squad squat stair stare steak steal steam steel steer stern stone store strap
straw strip suite swamp swear sweat sworn table teach tense thank there those title trace
track trade trail trend trial twice ultra usual waist
`;

const PAR_5 = `
bound derby diver dodge doing fever fiber found fudge funny giver going guide hedge hound
hover judge lever liver lover lower mound movie offer peril pound power queue rebel refer
reply rider river ruler shade shake shame shape shave sting upper wedge wider wound young
`;

const toSet = (source) => new Set(source.split(/\s+/).filter(Boolean));

export const PAR_3_WORDS = toSet(PAR_3);
export const PAR_5_WORDS = toSet(PAR_5);

// Everything not called short or long is an honest par 4.
export function tabulatedPar(word) {
  if (PAR_3_WORDS.has(word)) return 3;
  if (PAR_5_WORDS.has(word)) return 5;
  return 4;
}
