const fs = require('fs');
const path = require('path');

const words = fs
  .readFileSync(path.join(__dirname, '..', 'wordlist.txt'), 'utf8')
  .split('\n')
  .map(w => w.trim())
  .filter(Boolean);

function randomWord() {
  return words[Math.floor(Math.random() * words.length)];
}

function generateRoomId() {
  return (randomWord() + randomWord() + randomWord()).toLowerCase();
}

module.exports = { generateRoomId };
