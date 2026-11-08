'use strict';
// Turns a notifier note into the tray's "toast <base64 JSON>" line, with the
// pictures a Windows notification can show: the model being printed (hero
// image) and the printer's photo (small round logo). Windows reads pictures
// from local files, so the model picture is written to Edge Deck's data folder.
const fs = require('node:fs');
const path = require('node:path');

const PHOTOS = { H2D: 'h2d-photo.png', P1S: 'p1s-photo.png' };
const EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg' };

function createToastLines({ directory, assets = path.join(__dirname, '..', 'src', 'assets'), picture = () => null }) {
  const folder = path.join(directory, 'notifications');
  let count = 0;
  function modelPicture(printerId) {
    const found = picture(printerId);
    const extension = found && EXTENSIONS[found.type];
    if (!extension || !Buffer.isBuffer(found.data) || !found.data.length) return null;
    try {
      fs.mkdirSync(folder, { recursive: true });
      // A new name each time: Windows caches pictures by path.
      for (const old of fs.readdirSync(folder)) if (/^model-/.test(old)) fs.rmSync(path.join(folder, old), { force: true });
      const file = path.join(folder, `model-${String(printerId).replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}-${count++}${extension}`);
      fs.writeFileSync(file, found.data);
      return file;
    } catch { return null; }
  }
  return function toastLine(note) {
    const toast = { kind: note.kind === 'warning' ? 'warning' : 'info', title: note.title, body: note.body };
    if (note.attribution) toast.attribution = note.attribution;
    if (note.printerId) {
      const image = modelPicture(note.printerId);
      if (image) toast.image = image;
      const photo = PHOTOS[note.model] && path.join(assets, 'printers', PHOTOS[note.model]);
      if (photo && fs.existsSync(photo)) toast.logo = photo;
    }
    return `toast ${Buffer.from(JSON.stringify(toast), 'utf8').toString('base64')}`;
  };
}

module.exports = { createToastLines };
