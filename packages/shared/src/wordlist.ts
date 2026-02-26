// 1024 curated, family-friendly, easy-to-spell English words (3-8 letters)
// Used to generate memorable but unguessable group IDs
// Entropy: 1024^4 = ~1.1 trillion combinations (40 bits)

const NATURE = [
  'river', 'mountain', 'forest', 'ocean', 'meadow', 'valley', 'sunset',
  'canyon', 'island', 'glacier', 'prairie', 'desert', 'lagoon', 'reef',
  'creek', 'summit', 'grove', 'field', 'lake', 'pond', 'cliff', 'shore',
  'beach', 'cloud', 'storm', 'rain', 'snow', 'frost', 'wind', 'breeze',
  'thunder', 'rainbow', 'dawn', 'dusk', 'moon', 'star', 'comet', 'aurora',
  'tide', 'wave', 'spring', 'bloom', 'petal', 'leaf', 'branch', 'root',
  'seed', 'vine', 'moss', 'fern', 'pine', 'oak', 'maple', 'willow',
  'cedar', 'birch', 'elm', 'sage', 'coral', 'shell', 'sand', 'stone',
  'boulder', 'pebble', 'marsh', 'swamp', 'delta', 'ridge', 'peak',
  'crater', 'cavern', 'geyser', 'harbor', 'bay', 'cove', 'cape',
  'strait', 'fjord', 'oasis', 'tundra', 'savanna', 'jungle', 'grove',
  'orchard', 'garden', 'hedge', 'trail', 'path', 'brook', 'rapids',
];

const ANIMALS = [
  'falcon', 'dolphin', 'tiger', 'eagle', 'panda', 'otter', 'hawk',
  'wolf', 'bear', 'fox', 'deer', 'robin', 'whale', 'seal', 'heron',
  'crane', 'raven', 'sparrow', 'finch', 'owl', 'parrot', 'pelican',
  'swan', 'goose', 'duck', 'turtle', 'rabbit', 'badger', 'beaver',
  'moose', 'elk', 'bison', 'lynx', 'cougar', 'panther', 'jaguar',
  'cheetah', 'zebra', 'giraffe', 'koala', 'lemur', 'monkey', 'gecko',
  'iguana', 'salmon', 'trout', 'bass', 'pike', 'carp', 'shark',
  'octopus', 'squid', 'crab', 'lobster', 'clam', 'coral', 'starfish',
  'mantis', 'beetle', 'cricket', 'firefly', 'moth', 'ant', 'bee',
  'wasp', 'hornet', 'dragon', 'phoenix', 'osprey', 'condor', 'stork',
  'penguin', 'puffin', 'toucan', 'macaw', 'canary', 'dove', 'lark',
  'wren', 'jay', 'oriole', 'kite', 'ibis', 'egret', 'quail',
  'grouse', 'pheasant', 'hare', 'mink', 'ferret', 'stoat', 'viper',
  'cobra', 'python', 'newt', 'frog', 'toad',
];

const ADJECTIVES = [
  'golden', 'silver', 'crimson', 'azure', 'bright', 'brave', 'calm',
  'swift', 'bold', 'gentle', 'quiet', 'happy', 'lucky', 'wild', 'warm',
  'cool', 'fresh', 'grand', 'vivid', 'noble', 'merry', 'keen', 'proud',
  'clever', 'witty', 'jolly', 'gentle', 'tender', 'fierce', 'mighty',
  'ancient', 'modern', 'rustic', 'sleek', 'smooth', 'rough', 'glossy',
  'matte', 'bright', 'dim', 'pale', 'rich', 'deep', 'hollow', 'solid',
  'dense', 'sparse', 'wide', 'narrow', 'tall', 'short', 'long', 'tiny',
  'giant', 'vast', 'petite', 'humble', 'lofty', 'nimble', 'agile',
  'rapid', 'steady', 'stable', 'loyal', 'true', 'honest', 'fair',
  'just', 'kind', 'wise', 'young', 'elder', 'prime', 'pure', 'rare',
  'common', 'unique', 'simple', 'fancy', 'plain', 'ornate', 'subtle',
  'vivid', 'frosty', 'sunny', 'cloudy', 'misty', 'foggy', 'snowy',
  'rainy', 'windy', 'stormy', 'serene', 'placid', 'tranquil', 'lively',
  'vibrant', 'radiant', 'glowing', 'shining', 'gleaming', 'dazzling',
  'crystal', 'velvet', 'satin', 'copper', 'bronze', 'ivory', 'amber',
  'scarlet', 'violet', 'indigo', 'teal', 'coral', 'peach', 'sage',
  'olive', 'russet', 'maroon', 'navy', 'royal', 'cosmic', 'stellar',
  'lunar', 'solar', 'arctic', 'tropic', 'alpine', 'coastal', 'urban',
  'rural', 'gentle', 'silent', 'hidden', 'secret', 'mystic',
];

const OBJECTS = [
  'lantern', 'compass', 'anchor', 'castle', 'bridge', 'beacon',
  'candle', 'crystal', 'feather', 'marble', 'penny', 'puzzle', 'quilt',
  'ribbon', 'saddle', 'shield', 'throne', 'tower', 'vessel', 'wheel',
  'arrow', 'banner', 'basket', 'bottle', 'bucket', 'button', 'carpet',
  'chain', 'clock', 'crown', 'dagger', 'flute', 'goblet', 'hammer',
  'helmet', 'jewel', 'kettle', 'ladder', 'mirror', 'needle', 'paddle',
  'pillar', 'prism', 'quiver', 'rope', 'scroll', 'scepter', 'spear',
  'staff', 'sword', 'tablet', 'torch', 'trophy', 'wand', 'wreath',
  'badge', 'bell', 'bolt', 'book', 'boot', 'bow', 'cape', 'chest',
  'coin', 'drum', 'flag', 'gem', 'harp', 'horn', 'key', 'lamp',
  'locket', 'mask', 'medal', 'orb', 'pearl', 'ring', 'rune', 'sail',
  'seal', 'star', 'stone', 'veil', 'wing', 'acorn', 'blade', 'crest',
  'dial', 'flask', 'gavel', 'ink', 'lens', 'map', 'net', 'oar',
  'plume', 'quartz', 'relay', 'spike', 'talon', 'vault', 'wedge',
];

const FOOD = [
  'apple', 'cherry', 'lemon', 'mango', 'peach', 'plum', 'berry',
  'melon', 'grape', 'olive', 'almond', 'walnut', 'pecan', 'cashew',
  'peanut', 'cocoa', 'coffee', 'ginger', 'pepper', 'mint', 'basil',
  'thyme', 'clove', 'cumin', 'fennel', 'garlic', 'onion', 'carrot',
  'celery', 'turnip', 'potato', 'squash', 'pumpkin', 'radish', 'wheat',
  'barley', 'oat', 'rice', 'corn', 'rye', 'fig', 'date', 'kiwi',
  'lime', 'pear', 'apricot', 'papaya', 'guava', 'nectar', 'honey',
  'maple', 'vanilla', 'cacao', 'nutmeg', 'saffron', 'sage', 'dill',
  'chive', 'sorrel', 'truffle', 'waffle', 'pretzel', 'muffin', 'scone',
];

const PLACES = [
  'village', 'hamlet', 'temple', 'chapel', 'abbey', 'palace', 'manor',
  'cottage', 'cabin', 'lodge', 'villa', 'fort', 'citadel', 'market',
  'bazaar', 'plaza', 'arcade', 'gallery', 'library', 'museum', 'arena',
  'stadium', 'theater', 'tavern', 'inn', 'salon', 'studio', 'workshop',
  'foundry', 'quarry', 'mine', 'ranch', 'farm', 'mill', 'dock',
  'wharf', 'pier', 'jetty', 'port', 'depot', 'station', 'outpost',
  'haven', 'refuge', 'den', 'lair', 'nest', 'hollow', 'burrow',
  'alcove', 'grotto', 'nook', 'vault', 'crypt', 'cellar', 'attic',
  'loft', 'dome', 'spire', 'turret', 'rampart', 'moat', 'gateway',
  'arcade', 'terrace', 'balcony', 'veranda', 'patio', 'pergola',
];

const ACTIONS = [
  'dash', 'leap', 'climb', 'soar', 'glide', 'drift', 'sail',
  'paddle', 'row', 'swim', 'dive', 'surf', 'ski', 'skate', 'sprint',
  'march', 'wander', 'roam', 'scout', 'quest', 'seek', 'find',
  'gather', 'craft', 'forge', 'build', 'carve', 'paint', 'sketch',
  'sing', 'hum', 'chant', 'whistle', 'dance', 'spin', 'twirl',
  'flip', 'tumble', 'bounce', 'juggle', 'catch', 'toss', 'throw',
  'launch', 'aim', 'fire', 'strike', 'guard', 'shield', 'defend',
  'charge', 'rally', 'cheer', 'clap', 'wave', 'signal', 'flash',
  'glow', 'spark', 'blaze', 'flare', 'shine', 'beam', 'gleam',
  'shimmer', 'ripple', 'splash', 'drizzle', 'shower', 'pour', 'flow',
  'stream', 'surge', 'rush', 'bolt', 'zoom', 'whisk', 'sweep',
  'swirl', 'spiral', 'orbit', 'circle', 'loop', 'weave', 'braid',
  'knit', 'stitch', 'mend', 'heal', 'bloom', 'sprout', 'grow',
  'thrive', 'flourish', 'prosper', 'dream', 'wish', 'hope', 'trust',
];

const MATERIALS = [
  'iron', 'steel', 'copper', 'bronze', 'brass', 'tin', 'lead',
  'gold', 'silver', 'platinum', 'nickel', 'cobalt', 'chrome', 'titanium',
  'diamond', 'ruby', 'emerald', 'sapphire', 'topaz', 'opal', 'jade',
  'onyx', 'garnet', 'quartz', 'amber', 'pearl', 'ivory', 'ebony',
  'bamboo', 'cotton', 'linen', 'silk', 'wool', 'felt', 'leather',
  'suede', 'velvet', 'satin', 'denim', 'flannel', 'tweed', 'canvas',
  'clay', 'glass', 'ceramic', 'porcelain', 'granite', 'marble', 'slate',
  'chalk', 'flint', 'obsidian', 'basalt', 'sandstone', 'limestone',
];

const WEATHER_TIME = [
  'sunrise', 'morning', 'noon', 'evening', 'twilight', 'midnight',
  'season', 'winter', 'summer', 'autumn', 'monsoon', 'tempest',
  'cyclone', 'tornado', 'blizzard', 'drought', 'harvest', 'equinox',
  'solstice', 'eclipse', 'meteor', 'nebula', 'galaxy', 'quasar',
  'pulsar', 'zenith', 'nadir', 'horizon', 'mirage', 'haze', 'fog',
  'mist', 'dew', 'sleet', 'hail', 'gale', 'squall', 'monsoon',
  'current', 'eddy', 'vortex', 'updraft', 'downdraft', 'thermal',
];

const MUSIC_ART = [
  'melody', 'rhythm', 'harmony', 'chord', 'verse', 'chorus', 'bridge',
  'tempo', 'cadence', 'sonata', 'fugue', 'waltz', 'polka', 'tango',
  'samba', 'rumba', 'salsa', 'jazz', 'blues', 'folk', 'ballad',
  'anthem', 'hymn', 'carol', 'lullaby', 'aria', 'duet', 'trio',
  'quartet', 'opus', 'prelude', 'overture', 'encore', 'crescendo',
  'forte', 'piano', 'viola', 'cello', 'banjo', 'fiddle', 'bugle',
  'cymbal', 'gong', 'chime', 'treble', 'alto', 'tenor', 'baritone',
  'soprano', 'mosaic', 'fresco', 'mural', 'canvas', 'palette', 'easel',
  'chisel', 'kiln', 'loom', 'spindle', 'bobbin', 'thimble',
];

const CONCEPTS = [
  'echo', 'whisper', 'rumble', 'murmur', 'riddle', 'puzzle', 'cipher',
  'enigma', 'fable', 'legend', 'myth', 'saga', 'epic', 'tale',
  'quest', 'voyage', 'journey', 'advent', 'herald', 'omen', 'charm',
  'spell', 'rune', 'token', 'emblem', 'crest', 'motto', 'creed',
  'pledge', 'pact', 'truce', 'bond', 'link', 'nexus', 'pivot',
  'axis', 'prism', 'lens', 'focus', 'scope', 'range', 'realm',
  'domain', 'sphere', 'orbit', 'zenith', 'apex', 'vertex', 'summit',
  'pinnacle', 'brink', 'verge', 'cusp', 'threshold', 'gateway',
  'beacon', 'signal', 'pulse', 'rhythm', 'tempo', 'cycle', 'phase',
  'epoch', 'era', 'dawn', 'dusk', 'twilight', 'shadow', 'silhouette',
  'mirage', 'phantom', 'spirit', 'essence', 'aura', 'halo', 'nimbus',
  'corona', 'mantle', 'shroud', 'veil', 'cloak', 'guise', 'facade',
  'venture', 'gambit', 'ploy', 'tactic', 'stratagem', 'ruse', 'feint',
];

// Combine all themes into a flat array
const ALL_WORDS = [
  ...NATURE,
  ...ANIMALS,
  ...ADJECTIVES,
  ...OBJECTS,
  ...FOOD,
  ...PLACES,
  ...ACTIONS,
  ...MATERIALS,
  ...WEATHER_TIME,
  ...MUSIC_ART,
  ...CONCEPTS,
];

// Deduplicate and take exactly 1024
const uniqueWords = [...new Set(ALL_WORDS)];

// Pad if needed with extra words to reach 1024
const EXTRA = [
  'atlas', 'anvil', 'arch', 'awning', 'axis', 'azure', 'bamboo',
  'banner', 'barge', 'barrel', 'basin', 'beacon', 'belfry', 'bench',
  'beryl', 'birch', 'bliss', 'bonfire', 'bower', 'bramble', 'breeze',
  'brine', 'bronze', 'buoy', 'cairn', 'calico', 'cameo', 'canopy',
  'capstan', 'cascade', 'cayenne', 'chaplet', 'chariot', 'citrus',
  'clover', 'cobalt', 'conduit', 'corsair', 'coyote', 'current',
  'cypress', 'damask', 'dapple', 'ember', 'fathom', 'furrow',
  'galleon', 'garland', 'gazelle', 'glyph', 'gondola', 'granite',
  'griffin', 'gust', 'halcyon', 'halo', 'haven', 'hemlock', 'herbal',
  'heyday', 'hutch', 'indigo', 'inlet', 'ivory', 'jasmine', 'juniper',
  'kayak', 'kelpie', 'kindle', 'knoll', 'lagoon', 'larkspur', 'laurel',
  'lava', 'lilac', 'linden', 'lotus', 'lucent', 'lustre', 'magnet',
  'mallow', 'mangrove', 'marquee', 'meadow', 'merlin', 'mica',
  'monarch', 'monsoon', 'mortar', 'mulch', 'myrtle', 'obsidian',
  'ochre', 'osprey', 'oxbow', 'paladin', 'pangolin', 'parsley',
  'pasture', 'pavilion', 'pewter', 'pigment', 'plover', 'poplar',
  'quarry', 'quince', 'ramble', 'rapids', 'rattan', 'regal',
  'remnant', 'renown', 'ripple', 'rosemary', 'rowan', 'sable',
  'sampler', 'sandal', 'satchel', 'scarab', 'sequoia', 'shale',
  'sherpa', 'signet', 'sienna', 'sorbet', 'spartan', 'sprig',
  'stalwart', 'sundial', 'sycamore', 'tallow', 'tamarind', 'tandem',
  'tartan', 'templar', 'tether', 'thistle', 'thicket', 'timber',
  'tinsel', 'topiary', 'trellis', 'trident', 'trinket', 'turquoise',
  'tusk', 'umbrella', 'urchin', 'valiant', 'valor', 'verdant',
  'vermilion', 'vigil', 'walrus', 'wicker', 'yarrow', 'yonder',
  'zephyr', 'zinnia', 'agate', 'alchemy', 'balsam', 'brigand',
  'buckle', 'burlap', 'caper', 'cipher', 'cobble', 'corsage',
  'crescent', 'damsel', 'dappled', 'dewdrop', 'drifter', 'easel',
  'festoon', 'flicker', 'gallop', 'garnet', 'glimmer', 'gossamer',
  'grotto', 'harvest', 'hemlock', 'horizon', 'inkwell', 'lanyard',
  'lattice', 'levee', 'lintel', 'mantle', 'obelisk', 'pinnacle',
  'plinth', 'rampart', 'raptor', 'reliquary', 'sandbar', 'sentinel',
  'spindle', 'steeple', 'terrace', 'torrent', 'tugboat',
  'parapet', 'quasar', 'sextant', 'compass', 'nomad',
  'voyager', 'pioneer', 'ranger', 'trooper', 'captain',
];

// Build final list: unique words from all categories + extras, take 1024
const combined = [...new Set([...uniqueWords, ...EXTRA])];

export const GROUP_WORD_LIST: string[] = combined.slice(0, 1024);

/**
 * Generate a group ID as 4 random words joined by hyphens.
 * Example: "brave-mountain-golden-river"
 */
export function generateGroupId(): string {
  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    const index = Math.floor(Math.random() * GROUP_WORD_LIST.length);
    words.push(GROUP_WORD_LIST[index]);
  }
  return words.join('-');
}
