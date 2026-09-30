// =============================================================================
// main.js — bootstrap: hvata DOM, pravi Game
// =============================================================================
import { Game } from './Game.js';

const $ = (id) => document.getElementById(id);

const game = new Game($('game'), {
  menu: $('menu'),
  death: $('death'),
  playBtn: $('playBtn'),
  respawnBtn: $('respawnBtn'),
  nameInput: $('nameInput'),
  deathCause: $('deathCause'),
  deathStats: $('deathStats'),
  touch: $('touchControls'),
  boostBtn: $('boostBtn'),
  dashBtn: $('dashBtn'),
  magnetBtn: $('magnetBtn'),
  empBtn: $('empBtn'),
});

// random startno ime
const CALLSIGNS = ['VIPER', 'NEON', 'GHOST', 'FLUX', 'ZERO', 'ONYX', 'RIOT', 'ECHO'];
$('nameInput').value = `${CALLSIGNS[(Math.random() * CALLSIGNS.length) | 0]}-${(Math.random() * 90 + 10) | 0}`;

globalThis.game = game; // za debug u konzoli
