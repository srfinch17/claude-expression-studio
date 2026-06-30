// studio/showcase.js, the curated AMBIENT showcase: the kinetic-art pieces that
// play when nobody is driving the face. Firmware sims + scenic saved animations.
// Communicative glyphs (done/alert/smiley/cross/wait-*/ask-*/idea/task-complete,
// the mascot claude-idle) are deliberately OUT, they only show when Claude actually
// drives the panel, but stay reachable via the click-to-pin strip.
// Hand-tunable: add or remove a name to change the resting face. Names that don't
// resolve to a real animation are silently skipped (see buildPlaylists).

export const SHOWCASE = [
  // firmware sims (all 15 are kinetic art)
  "claudesweep", "frostbite", "fire", "matrix_rain", "snow", "fireworks",
  "dancefloor", "rainbow", "breathe", "wave", "comet", "spiral", "starfield",
  "sun", "liquid",
  // scenic saved animations
  "atom", "bloom", "bomb", "butterfly", "compactor", "crystal-ball",
  "double-slit", "dusk", "fireflies", "goldfish", "hourglass", "inchworm",
  "jack-o-lantern", "jellyfish", "jupiter", "lava-lamp", "lightning", "meteor",
  "mushroom-cloud", "newtons-cradle", "potion", "rain", "reticle",
  "ringed-planet", "soundwave", "spinning-coin", "sunrise", "tornado", "ufo",
  "volcano", "warp-portal", "warrocket",
  // scenic anims that happen to be wired to other moments
  "aurora", "black-hole", "galaxy", "skull", "swarm-merge",
];
