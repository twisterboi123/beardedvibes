import pg from 'pg';
import Database from 'better-sqlite3';

const { Pool } = pg;

export function createDatabase(config) {
  if (config.type === 'postgres') {
    const pool = new Pool({ connectionString: config.url, ssl: config.ssl ? { rejectUnauthorized: false } : false });

    const postWithLikes = `
      SELECT p.*, COALESCE(lc.count, 0) AS likes
      FROM posts p
      LEFT JOIN (
        SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
      ) lc ON lc.postId = p.id
      WHERE p.id = $1
    `;

    return {
      async init() {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            discordId TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL,
            avatar TEXT,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lastSeenAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            uploaderDiscordId TEXT NOT NULL,
            uploaderName TEXT DEFAULT '',
            status TEXT NOT NULL,
            editToken TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            format TEXT NOT NULL DEFAULT 'long'
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS likes (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(postId, userId)
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS history (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            viewedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(postId, userId)
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS watchlist (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            addedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(postId, userId)
          );
        `);
        await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS uploaderName TEXT DEFAULT ''`);
        await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'long'`);
        await pool.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS userId INTEGER REFERENCES users(id)`);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_comments_postId ON comments(postId)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_history_user ON history(userId, viewedAt DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(userId, addedAt DESC)');
      },

      async upsertUser({ discordId, username, avatar }) {
        const res = await pool.query(
          `INSERT INTO users (discordId, username, avatar)
           VALUES ($1, $2, $3)
           ON CONFLICT (discordId) DO UPDATE SET username = EXCLUDED.username, avatar = EXCLUDED.avatar, lastSeenAt = NOW()
           RETURNING id, discordId AS "discordId", username, avatar`,
          [discordId, username, avatar]
        );
        return res.rows[0];
      },

      async getUserById(id) {
        const res = await pool.query(
          `SELECT id, discordId AS "discordId", username, avatar
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [id]
        );
        return res.rows[0];
      },

      async insertPost(data) {
        const res = await pool.query(
          `INSERT INTO posts (filename, type, title, description, uploaderDiscordId, uploaderName, status, editToken, createdAt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            data.filename,
            data.type,
            data.title,
            data.description,
            data.uploaderDiscordId,
            data.uploaderName,
            data.status,
            data.editToken,
            data.createdAt
          ]
        );
        return { lastInsertRowid: res.rows[0].id };
      },

      async getPost(id) {
        const res = await pool.query(postWithLikes, [id]);
        return res.rows[0];
      },

      async listPublished() {
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes
          FROM posts p
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          WHERE p.status = 'published'
          ORDER BY p.id DESC
        `);
        return res.rows;
      },

      async listTrending() {
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes
          FROM posts p
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          WHERE p.status = 'published'
          ORDER BY lc.count DESC NULLS LAST, p.createdAt DESC
          LIMIT 100
        `);
        return res.rows;
      },

      async listLiked(userId) {
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes
          FROM likes l
          JOIN posts p ON p.id = l.postId
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          WHERE l.userId = $1 AND p.status = 'published'
          ORDER BY l.createdAt DESC
        `, [userId]);
        return res.rows;
      },

      async listHistory(userId) {
        const res = await pool.query(`
          SELECT p.*, h.viewedAt, COALESCE(lc.count, 0) AS likes
          FROM history h
          JOIN posts p ON p.id = h.postId
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          WHERE h.userId = $1 AND p.status = 'published'
          ORDER BY h.viewedAt DESC
        `, [userId]);
        return res.rows;
      },

      async listWatchlist(userId) {
        const res = await pool.query(`
          SELECT p.*, w.addedAt, COALESCE(lc.count, 0) AS likes
          FROM watchlist w
          JOIN posts p ON p.id = w.postId
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          WHERE w.userId = $1 AND p.status = 'published'
          ORDER BY w.addedAt DESC
        `, [userId]);
        return res.rows;
      },

      async publishPost(data) {
        await pool.query(
          `UPDATE posts SET title = $1, description = $2, status = 'published' WHERE id = $3`,
          [data.title, data.description, data.id]
        );
      },

      async setLike(postId, userId, like) {
        if (like) {
          await pool.query(
            `INSERT INTO likes (postId, userId) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [postId, userId]
          );
        } else {
          await pool.query(`DELETE FROM likes WHERE postId = $1 AND userId = $2`, [postId, userId]);
        }
        const res = await pool.query('SELECT COUNT(*)::INT AS count FROM likes WHERE postId = $1', [postId]);
        return res.rows[0].count;
      },

      async hasUserLiked(postId, userId) {
        const res = await pool.query('SELECT 1 FROM likes WHERE postId = $1 AND userId = $2 LIMIT 1', [postId, userId]);
        return Boolean(res.rows[0]);
      },

      async getUserLikes(userId) {
        const res = await pool.query('SELECT postId FROM likes WHERE userId = $1', [userId]);
        return res.rows.map((r) => Number(r.postid ?? r.postId));
      },

      async insertComment(postId, userId, text, createdAt) {
        const res = await pool.query(
          'INSERT INTO comments (postId, userId, text, createdAt) VALUES ($1, $2, $3, $4) RETURNING id',
          [postId, userId, text, createdAt]
        );
        return res.rows[0].id;
      },

      async listComments(postId) {
        const res = await pool.query(
          `SELECT c.id, c.text, c.createdAt, u.username AS author
           FROM comments c
           JOIN users u ON u.id = c.userId
           WHERE c.postId = $1
           ORDER BY c.id DESC`,
          [postId]
        );
        return res.rows;
      },

      async recordView(postId, userId) {
        await pool.query(`
          INSERT INTO history (postId, userId, viewedAt)
          VALUES ($1, $2, NOW())
          ON CONFLICT (postId, userId)
          DO UPDATE SET viewedAt = EXCLUDED.viewedAt
        `, [postId, userId]);
      },

      async setWatchLater(postId, userId, add) {
        if (add) {
          await pool.query(`
            INSERT INTO watchlist (postId, userId, addedAt)
            VALUES ($1, $2, NOW())
            ON CONFLICT (postId, userId) DO NOTHING
          `, [postId, userId]);
          return true;
        }
        await pool.query('DELETE FROM watchlist WHERE postId = $1 AND userId = $2', [postId, userId]);
        return false;
      },

      async hasWatchLater(postId, userId) {
        const res = await pool.query('SELECT 1 FROM watchlist WHERE postId = $1 AND userId = $2 LIMIT 1', [postId, userId]);
        return Boolean(res.rows[0]);
      }
    };
  }

  // SQLite fallback
  const db = new Database(config.path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discordId TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      avatar TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastSeenAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      uploaderDiscordId TEXT NOT NULL,
      uploaderName TEXT DEFAULT '',
      status TEXT NOT NULL,
      editToken TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'long'
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(postId, userId),
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      viewedAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(postId, userId),
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      addedAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(postId, userId),
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_postId ON comments(postId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_user ON history(userId, viewedAt)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(userId, addedAt)');

  const postColumns = db.prepare("PRAGMA table_info(posts)").all();
  const commentColumns = db.prepare("PRAGMA table_info(comments)").all();

  if (!postColumns.some((r) => r.name === 'uploaderName')) {
    db.exec("ALTER TABLE posts ADD COLUMN uploaderName TEXT DEFAULT ''");
  }

  if (!postColumns.some((r) => r.name === 'format')) {
    db.exec("ALTER TABLE posts ADD COLUMN format TEXT DEFAULT 'long'");
  }

  if (!commentColumns.some((r) => r.name === 'userId')) {
    db.exec('ALTER TABLE comments ADD COLUMN userId INTEGER');
  }

  const upsertUserStmt = db.prepare(`
    INSERT INTO users (discordId, username, avatar)
    VALUES (@discordId, @username, @avatar)
    ON CONFLICT(discordId) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, lastSeenAt = datetime('now')
    RETURNING id, discordId, username, avatar
  `);
  const insertPostStmt = db.prepare(`
    INSERT INTO posts (filename, type, title, description, uploaderDiscordId, uploaderName, status, editToken, createdAt)
    VALUES (@filename, @type, @title, @description, @uploaderDiscordId, @uploaderName, @status, @editToken, @createdAt)
  `);
  const getPostStmt = db.prepare(`
    SELECT p.*, COALESCE(lc.count, 0) AS likes
    FROM posts p
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    WHERE p.id = ?
  `);
  const listPublishedStmt = db.prepare(`
    SELECT p.*, COALESCE(lc.count, 0) AS likes
    FROM posts p
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    WHERE p.status = 'published'
    ORDER BY p.id DESC
  `);
  const listTrendingStmt = db.prepare(`
    SELECT p.*, COALESCE(lc.count, 0) AS likes
    FROM posts p
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    WHERE p.status = 'published'
    ORDER BY lc.count DESC, p.createdAt DESC
    LIMIT 100
  `);
  const publishPostStmt = db.prepare(`UPDATE posts SET title = @title, description = @description, status = 'published' WHERE id = @id`);
  const hasLikeStmt = db.prepare('SELECT 1 FROM likes WHERE postId = ? AND userId = ?');
  const insertLikeStmt = db.prepare('INSERT OR IGNORE INTO likes (postId, userId) VALUES (?, ?)');
  const deleteLikeStmt = db.prepare('DELETE FROM likes WHERE postId = ? AND userId = ?');
  const countLikesStmt = db.prepare('SELECT COUNT(*) AS count FROM likes WHERE postId = ?');
  const userLikesStmt = db.prepare('SELECT postId FROM likes WHERE userId = ?');
  const insertCommentStmt = db.prepare('INSERT INTO comments (postId, userId, text, createdAt) VALUES (?, ?, ?, ?)');
  const listCommentsStmt = db.prepare(`
    SELECT c.id, c.text, c.createdAt, u.username AS author
    FROM comments c
    JOIN users u ON u.id = c.userId
    WHERE c.postId = ?
    ORDER BY c.id DESC
  `);
  const recordViewUpsertStmt = db.prepare(`
    INSERT INTO history (postId, userId, viewedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(postId, userId) DO UPDATE SET viewedAt = excluded.viewedAt
  `);
  const listHistoryStmt = db.prepare(`
    SELECT p.*, h.viewedAt, COALESCE(lc.count, 0) AS likes
    FROM history h
    JOIN posts p ON p.id = h.postId
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    WHERE h.userId = ? AND p.status = 'published'
    ORDER BY h.viewedAt DESC
  `);
  const addWatchStmt = db.prepare(`
    INSERT INTO watchlist (postId, userId, addedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(postId, userId) DO NOTHING
  `);
  const removeWatchStmt = db.prepare('DELETE FROM watchlist WHERE postId = ? AND userId = ?');
  const hasWatchStmt = db.prepare('SELECT 1 FROM watchlist WHERE postId = ? AND userId = ?');
  const listWatchlistStmt = db.prepare(`
    SELECT p.*, w.addedAt, COALESCE(lc.count, 0) AS likes
    FROM watchlist w
    JOIN posts p ON p.id = w.postId
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    WHERE w.userId = ? AND p.status = 'published'
    ORDER BY w.addedAt DESC
  `);

  return {
    async init() {},

    async upsertUser(data) {
      return upsertUserStmt.get(data);
    },

    async getUserById(id) {
      return db.prepare('SELECT id, discordId, username, avatar FROM users WHERE id = ? LIMIT 1').get(id);
    },

    insertPost: (data) => Promise.resolve(insertPostStmt.run(data)),

    getPost: (id) => Promise.resolve(getPostStmt.get(id)),

    listPublished: () => Promise.resolve(listPublishedStmt.all()),

    listTrending: () => Promise.resolve(listTrendingStmt.all()),

    publishPost: (data) => Promise.resolve(publishPostStmt.run(data)),

    async setLike(postId, userId, like) {
      if (like) {
        insertLikeStmt.run(postId, userId);
      } else {
        deleteLikeStmt.run(postId, userId);
      }
      const res = countLikesStmt.get(postId);
      return res.count;
    },

    async hasUserLiked(postId, userId) {
      const row = hasLikeStmt.get(postId, userId);
      return Boolean(row);
    },

    async getUserLikes(userId) {
      return userLikesStmt.all(userId).map((r) => r.postId);
    },

    insertComment: (postId, userId, text, createdAt) => Promise.resolve(insertCommentStmt.run(postId, userId, text, createdAt).lastInsertRowid),

    listComments: (postId) => Promise.resolve(listCommentsStmt.all(postId))
    ,

    async recordView(postId, userId) {
      recordViewUpsertStmt.run(postId, userId);
    },

    async listHistory(userId) {
      return listHistoryStmt.all(userId);
    },

    async setWatchLater(postId, userId, add) {
      if (add) {
        addWatchStmt.run(postId, userId);
        return true;
      }
      removeWatchStmt.run(postId, userId);
      return false;
    },

    async hasWatchLater(postId, userId) {
      const row = hasWatchStmt.get(postId, userId);
      return Boolean(row);
    },

    async listWatchlist(userId) {
      return listWatchlistStmt.all(userId);
    }
  };
}
