import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the server's data.sqlite which has the actual data
const db = new Database(path.resolve(__dirname, 'data.sqlite'));

const cols = db.prepare('PRAGMA table_info(posts)').all();
console.log('Existing columns:', cols.map(c => c.name));

if (!cols.some(c => c.name === 'format')) {
  console.log('Adding format column...');
  db.exec("ALTER TABLE posts ADD COLUMN format TEXT DEFAULT 'long'");
  console.log('Done! Format column added.');
} else {
  console.log('Format column already exists.');
}

// Now update existing images to have format='photo'
const updated = db.prepare("UPDATE posts SET format = 'photo' WHERE type = 'image'").run();
console.log(`Updated ${updated.changes} images to format='photo'`);

// Publish all draft photos
const published = db.prepare("UPDATE posts SET status = 'published' WHERE type = 'image' AND status = 'draft'").run();
console.log(`Published ${published.changes} draft photos`);

// Show all photos
const photos = db.prepare("SELECT id, title, type, format, uploaderDiscordId, status FROM posts WHERE type = 'image' OR format = 'photo'").all();
console.log('\nPhotos in database:');
photos.forEach(p => console.log(`  ID ${p.id}: type=${p.type}, format=${p.format}, status=${p.status}, uploader=${p.uploaderDiscordId}`));

// Show all posts
console.log('\nAll posts:');
const posts = db.prepare('SELECT id, title, type, format, status FROM posts').all();
posts.forEach(p => console.log(`  ${p.id}: "${p.title}" - type=${p.type}, format=${p.format}, status=${p.status}`));

db.close();
