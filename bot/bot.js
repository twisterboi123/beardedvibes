import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import dotenv from 'dotenv';
import { fetch, FormData, File } from 'undici';
import mime from 'mime-types';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config();

const BOT_BRAND = 'BeardedVibes';
const token = process.env.BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const uploadEndpoint = process.env.BACKEND_UPLOAD_URL;
const frontendBase = (process.env.FRONTEND_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

if (!token || !targetChannelId || !uploadEndpoint) {
  throw new Error('BOT_TOKEN, TARGET_CHANNEL_ID, and BACKEND_UPLOAD_URL must be set');
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm']);
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm'
]);


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag} (BeardedVibes bot branding)`);
  c.user.setPresence({ activities: [{ name: `${BOT_BRAND} uploads` }] });
});


function isAllowedAttachment(attachment) {
  const ext = path.extname(attachment.name || '').toLowerCase();
  const mimetype = attachment.contentType || mime.lookup(ext) || '';
  const isAllowed = ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIME.has(mimetype);
  if (!isAllowed) {
    console.log(`Attachment rejected: name=${attachment.name}, ext=${ext}, contentType=${attachment.contentType}, mimeLookup=${mime.lookup(ext)}, finalMime=${mimetype}, extAllowed=${ALLOWED_EXTENSIONS.has(ext)}, mimeAllowed=${ALLOWED_MIME.has(mimetype)}`);
  }
  return isAllowed;
}


async function downloadAttachment(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}


async function sendToBackend(buffer, attachment, uploaderDiscordId, uploaderDiscordName) {
  const ext = path.extname(attachment.name || '').toLowerCase();
  const mimetype = attachment.contentType || mime.lookup(ext) || 'application/octet-stream';
  const file = new File([buffer], attachment.name || `upload${ext || ''}`, { type: mimetype });

  const form = new FormData();
  form.append('file', file);
  form.append('uploaderDiscordId', uploaderDiscordId);
  form.append('uploaderDiscordName', uploaderDiscordName || 'Unknown');

  console.log(`Sending to ${uploadEndpoint} with mimetype=${mimetype}, filename=${attachment.name}`);
  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    body: form
  });

  console.log(`Backend response status: ${response.status} ${response.statusText}`);
  if (!response.ok) {
    const text = await response.text();
    console.log(`Backend error response body: ${text}`);
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  const result = await response.json();
  console.log(`Backend response JSON:`, result);
  return result;
}


async function handleAttachment(message, attachment) {
  try {
    console.log(`Processing attachment: name=${attachment.name}, contentType=${attachment.contentType}, url=${attachment.url}`);
    const buffer = await downloadAttachment(attachment.url);
    console.log(`Downloaded buffer size: ${buffer.length} bytes`);
    const result = await sendToBackend(buffer, attachment, message.author.id, message.author.username);
    console.log(`Backend response:`, result);
    const editLink = `${frontendBase}/edit/${result.id}?token=${result.editToken}`;

    try {
      await message.author.send(
         `Thanks! Your upload is saved as draft. Edit and publish here: ${editLink}`
      );
    } catch (dmErr) {
      console.error('Failed to send DM to user', dmErr);
    }

    console.log(`Uploaded attachment ${attachment.id} for user ${message.author.id}`);
  } catch (err) {
    console.error('Failed to process attachment', err);
    try {
      await message.reply('Sorry, I could not process that attachment. Please try again.');
    } catch (sendErr) {
      console.error('Failed to notify user in channel', sendErr);
    }
  }
}


client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== targetChannelId) return;
  if (!message.attachments?.size) return;

  const allowed = message.attachments.filter((att) => isAllowedAttachment(att));
  if (!allowed.size) return;

  for (const attachment of allowed.values()) {
    await handleAttachment(message, attachment);
  }
});

client.login(token);
