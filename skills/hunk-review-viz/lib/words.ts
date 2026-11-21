// words.ts — speakable IDs. Two short common words that speech-to-text spells right and that
// don't sound like each other, picked by a fingerprint so the same content always gets the same name.

const ADJECTIVES = `amber brave bright calm clever cosmic crisp curly dusty eager early fancy fiery fluffy
frosty fuzzy gentle giant glossy golden grassy happy hidden hollow humble icy jolly juicy kind lazy
lemon little lively lucky lunar magic mellow merry mighty misty modern muddy noble olive orange
patient peachy plain plucky polar proud purple quick quiet rapid rocky rosy rusty salty sandy shiny
silent silver simple sleepy slow smoky snowy solar spicy steady stormy sturdy sunny swift tidy tiny
velvet violet wavy windy wise witty woolly young zesty bold breezy cheery chilly cozy dainty dizzy
fearless friendly frozen gloomy grumpy hasty hearty honest jumpy keen loud loyal mossy nimble odd
painted pebbly playful polished quirky rainy rugged scarlet shy silky sneaky sparkly speedy spotted
sugary tender thirsty wild`
  .split(/\s+/)
  .filter(Boolean);

const NOUNS = `falcon otter badger beacon bison canyon cactus comet coral crane dolphin dragon eagle
ember fern ferret forest fox garden glacier harbor hawk heron island jaguar kettle koala lantern
lemur lily llama lotus magnet maple meadow meteor moose nebula needle oak ocean orchid owl panda
parrot pebble pepper pine planet pony puffin quarry rabbit raven reef river robin rocket saddle
salmon sparrow spider squirrel summit tiger tomato tortoise tulip turtle valley violin walrus whale
willow wizard yak zebra anchor apple arrow bagel banjo barrel basket biscuit blanket bridge bucket
button candle castle cherry cloud cookie crayon crystal dune feather fiddle flute gecko goblin
hammock helmet hippo igloo jacket kayak kite ladder mango marble mitten muffin noodle onion
pickle pillow pirate pumpkin`
  .split(/\s+/)
  .filter(Boolean);

/** Two words from the first bytes of a hex fingerprint; `extra` adds a third, for a clash. */
export function words(fp: string, extra = false): string {
  const n = (i: number) => parseInt(fp.slice(i * 4, i * 4 + 4), 16);
  const pair = `${ADJECTIVES[n(0) % ADJECTIVES.length]} ${NOUNS[n(1) % NOUNS.length]}`;
  return extra ? `${ADJECTIVES[n(2) % ADJECTIVES.length]} ${pair}` : pair;
}

/** Normalize what someone said or typed ("Amber-Falcon", "amber  falcon") to an ID's form. */
export function normalizeId(spoken: string): string {
  return spoken.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

export const WORD_COUNTS = { adjectives: ADJECTIVES.length, nouns: NOUNS.length };
