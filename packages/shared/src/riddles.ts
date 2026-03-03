export interface Riddle {
  id: string;
  text: string;
  answer: string; // uppercase, max 10 characters
  hint?: string;
}

// Family-friendly riddles with short answers (max 10 chars) for Wordle-style guessing
export const RIDDLES: Riddle[] = [
  { id: 'r1', text: 'I have hands but I can\'t clap. What am I?', answer: 'CLOCK', hint: 'Tick tock' },
  { id: 'r2', text: 'I have a head and a tail but no body. What am I?', answer: 'COIN', hint: 'Found in pockets' },
  { id: 'r3', text: 'What has keys but no locks?', answer: 'PIANO', hint: 'Makes music' },
  { id: 'r4', text: 'What has a neck but no head?', answer: 'BOTTLE', hint: 'Holds liquid' },
  { id: 'r5', text: 'What gets wetter the more it dries?', answer: 'TOWEL', hint: 'Found in bathrooms' },
  { id: 'r6', text: 'What can you catch but not throw?', answer: 'COLD', hint: 'Achoo!' },
  { id: 'r7', text: 'What has teeth but cannot bite?', answer: 'COMB', hint: 'Used on hair' },
  { id: 'r8', text: 'What has one eye but cannot see?', answer: 'NEEDLE', hint: 'Used for sewing' },
  { id: 'r9', text: 'What goes up but never comes down?', answer: 'AGE', hint: 'Everyone has one' },
  { id: 'r10', text: 'What has legs but doesn\'t walk?', answer: 'TABLE', hint: 'Found in kitchens' },
  { id: 'r11', text: 'What has a thumb and four fingers but is not alive?', answer: 'GLOVE', hint: 'Keeps hands warm' },
  { id: 'r12', text: 'What can travel around the world while staying in a corner?', answer: 'STAMP', hint: 'Found on mail' },
  { id: 'r13', text: 'What has many rings but no fingers?', answer: 'TREE', hint: 'Grows in forests' },
  { id: 'r14', text: 'What has a face and two hands but no arms or legs?', answer: 'CLOCK', hint: 'Tells the time' },
  { id: 'r15', text: 'What building has the most stories?', answer: 'LIBRARY', hint: 'Full of books' },
  { id: 'r16', text: 'What is full of holes but still holds water?', answer: 'SPONGE', hint: 'Used for cleaning' },
  { id: 'r17', text: 'I fly without wings. I cry without eyes. What am I?', answer: 'CLOUD', hint: 'In the sky' },
  { id: 'r18', text: 'What has a heart that doesn\'t beat?', answer: 'ARTICHOKE', hint: 'A vegetable' },
  { id: 'r19', text: 'What word becomes shorter when you add two letters?', answer: 'SHORT', hint: 'Think literally' },
  { id: 'r20', text: 'What has ears but cannot hear?', answer: 'CORN', hint: 'A crop' },
  { id: 'r21', text: 'What has a bark but no bite?', answer: 'TREE', hint: 'Grows tall' },
  { id: 'r22', text: 'What can fill a room but takes up no space?', answer: 'LIGHT', hint: 'Flip a switch' },
  { id: 'r23', text: 'What has words but never speaks?', answer: 'BOOK', hint: 'Read me' },
  { id: 'r24', text: 'What runs but never walks?', answer: 'WATER', hint: 'From a faucet' },
  { id: 'r25', text: 'What has a bed but never sleeps?', answer: 'RIVER', hint: 'Flows downstream' },
  { id: 'r26', text: 'What can you break without touching?', answer: 'PROMISE', hint: 'Keep your word' },
  { id: 'r27', text: 'What gets sharper the more you use it?', answer: 'BRAIN', hint: 'Think about it' },
  { id: 'r28', text: 'What is always in front of you but can\'t be seen?', answer: 'FUTURE', hint: 'Tomorrow' },
  { id: 'r29', text: 'What has cities, mountains, and water but no people?', answer: 'MAP', hint: 'Navigation tool' },
  { id: 'r30', text: 'What comes once in a minute, twice in a moment, but never in a thousand years?', answer: 'M', hint: 'A single letter' },
  { id: 'r31', text: 'What invention lets you look right through a wall?', answer: 'WINDOW', hint: 'Made of glass' },
  { id: 'r32', text: 'What has a bottom at the top?', answer: 'LEG', hint: 'Part of your body' },
  { id: 'r33', text: 'What can be cracked, made, told, and played?', answer: 'JOKE', hint: 'Ha ha!' },
  { id: 'r34', text: 'What kind of band never plays music?', answer: 'RUBBER', hint: 'Stretchy' },
  { id: 'r35', text: 'What has four wheels and flies?', answer: 'GARBAGE', hint: 'A smelly truck' },
  { id: 'r36', text: 'Where does Friday come before Thursday?', answer: 'DICTIONARY', hint: 'Alphabetical' },
  { id: 'r37', text: 'What month of the year has 28 days?', answer: 'ALL', hint: 'Every single one' },
  { id: 'r38', text: 'What is so fragile that saying its name breaks it?', answer: 'SILENCE', hint: 'Shhh!' },
  { id: 'r39', text: 'What can you hold in your left hand but not your right?', answer: 'ELBOW', hint: 'Part of your arm' },
  { id: 'r40', text: 'What tastes better than it smells?', answer: 'TONGUE', hint: 'In your mouth' },
  { id: 'r41', text: 'What has a spine but no bones?', answer: 'BOOK', hint: 'Found on shelves' },
  { id: 'r42', text: 'What can run but never walks, has a mouth but never talks?', answer: 'RIVER', hint: 'A body of water' },
  { id: 'r43', text: 'I have branches but no fruit, trunk, or leaves. What am I?', answer: 'BANK', hint: 'Money related' },
  { id: 'r44', text: 'What coat is best put on wet?', answer: 'PAINT', hint: 'Colorful' },
  { id: 'r45', text: 'What has a ring but no finger?', answer: 'PHONE', hint: 'Call me' },
  { id: 'r46', text: 'What goes up and down but doesn\'t move?', answer: 'STAIRS', hint: 'Step by step' },
  { id: 'r47', text: 'What is cut on a table but never eaten?', answer: 'CARDS', hint: 'Deck of fun' },
  { id: 'r48', text: 'What has an eye but cannot see?', answer: 'STORM', hint: 'Wild weather' },
  { id: 'r49', text: 'What kind of cup doesn\'t hold water?', answer: 'CUPCAKE', hint: 'Sweet treat' },
  { id: 'r50', text: 'What has a head, a tail, is brown, and has no legs?', answer: 'PENNY', hint: 'One cent' },
];

export const MAX_RIDDLE_ANSWER_LENGTH = 10;
export const RIDDLE_MAX_GUESSES = 5;
