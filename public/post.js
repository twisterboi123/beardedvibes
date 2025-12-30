const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const titleEl = document.getElementById('title');
const descriptionEl = document.getElementById('description');
const typePill = document.getElementById('type-pill');
const publishedAtEl = document.getElementById('published-at');
const uploaderTag = document.getElementById('uploader-tag');
const likeBtn = document.getElementById('like-btn');
const likeCount = document.getElementById('like-count');
const watchBtn = document.getElementById('watch-btn');
const commentsList = document.getElementById('comments-list');
const commentForm = document.getElementById('comment-form');
const commentText = document.getElementById('comment-text');
const commentSubmit = document.getElementById('comment-submit');
const commentHint = document.getElementById('comment-hint');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authLabel = document.getElementById('auth-label');

const state = {
  user: null,
  postId: null,
  liked: false,
  watchLater: false
};

function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
}

function renderPreview(data) {
  previewEl.innerHTML = '';
  if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.fileUrl;
    img.alt = data.title || 'Post preview';
    previewEl.appendChild(img);
  } else if (data.type === 'video') {
    const video = document.createElement('video');
    video.src = data.fileUrl;
    video.controls = true;
    video.playsInline = true;
    previewEl.appendChild(video);
  } else {
    previewEl.textContent = 'Unsupported file type';
  }
}

async function fetchPost(id) {
  const response = await fetch(`/api/post/${id}`);
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))).error || 'Post not found';
    throw new Error(message);
  }
  return response.json();
}

async function fetchComments(id) {
  const response = await fetch(`/api/post/${id}/comments`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.comments || [];
}

function renderComments(list) {
  commentsList.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No comments yet. Be the first!';
    commentsList.appendChild(empty);
    return;
  }
  list.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'comment';
    const author = document.createElement('div');
    author.className = 'author';
    author.textContent = c.author;
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = c.text;
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = new Date(c.createdAt).toLocaleString();
    card.append(author, text, time);
    commentsList.appendChild(card);
  });
}

async function likePost(id) {
  const response = await fetch(`/api/post/${id}/like`, { method: 'POST' });
  if (!response.ok) throw new Error('Unable to like right now');
  return response.json();
}

async function toggleWatchLater(id) {
  const response = await fetch(`/api/post/${id}/watchlater`, { method: 'POST' });
  if (!response.ok) throw new Error('Unable to update Watch Later');
  return response.json();
}

async function recordView(id) {
  const response = await fetch(`/api/post/${id}/view`, { method: 'POST' });
  if (!response.ok) return;
}

async function addComment(id, text) {
  const response = await fetch(`/api/post/${id}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const msg = (await response.json().catch(() => ({}))).error || 'Failed to post comment';
    throw new Error(msg);
  }
  return response.json();
}

function updateAuthUi() {
  if (state.user) {
    authLabel.textContent = `Logged in as ${state.user.username}`;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
    commentText.disabled = false;
    commentSubmit.disabled = false;
    commentHint.textContent = `Commenting as ${state.user.username}`;
  } else {
    authLabel.textContent = 'Not logged in. Likes and comments require Discord.';
    loginBtn.style.display = 'inline-flex';
    logoutBtn.style.display = 'none';
    commentText.disabled = true;
    commentSubmit.disabled = true;
    commentHint.textContent = 'Log in with Discord to comment.';
  }
}

async function loadUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error('No session');
    const data = await res.json();
    state.user = data.user;
  } catch (_err) {
    state.user = null;
  }
  updateAuthUi();
}

loginBtn.addEventListener('click', () => {
  window.location.href = '/api/auth/login';
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  updateAuthUi();
  updateLikeButton(false);
});

function updateLikeButton(liked) {
  state.liked = liked;
  likeBtn.classList.toggle('active', liked);
  const label = likeBtn.querySelector('span');
  if (label) {
    label.textContent = liked ? '❤️ Liked' : '♡ Like';
  }
}

function updateWatchButton(active) {
  state.watchLater = active;
  watchBtn.classList.toggle('active', active);
  watchBtn.textContent = active ? '✓ Saved' : '⏰ Watch Later';
}

async function init() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const id = pathParts[pathParts.length - 1];
  state.postId = id;

  const loadingOverlay = document.getElementById('loading-post');
  
  await loadUser();

  try {
    setStatus('Loading post…');
    const data = await fetchPost(id);
    
    // Hide loading overlay with fade
    setTimeout(() => {
      loadingOverlay.style.opacity = '0';
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 300);
    }, 500);
    
    titleEl.textContent = data.title || 'Untitled';
    descriptionEl.textContent = data.description || 'No description provided yet.';
    const formatLabel = data.format === 'short' ? 'Short' : 'Long form';
    typePill.textContent = data.type === 'video' ? `Video • ${formatLabel}` : 'Image';
    publishedAtEl.textContent = `Published on ${new Date(data.createdAt).toLocaleString()}`;
    uploaderTag.textContent = data.uploaderName ? `by ${data.uploaderName}` : 'Uploader unknown';
    likeCount.textContent = data.likes ?? 0;
    updateLikeButton(Boolean(data.liked));
    // watch later initial state (optional; not provided by API yet)
    try {
      if (state.user) await recordView(id);
    } catch (_e) {}
    renderPreview(data);
    setStatus('Published and ready to watch.', 'success');

    const initialComments = await fetchComments(id);
    renderComments(initialComments);

    likeBtn.addEventListener('click', async () => {
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      likeBtn.disabled = true;
      try {
        const result = await likePost(id);
        likeCount.textContent = result.likes;
        updateLikeButton(result.liked);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        likeBtn.disabled = false;
      }
    });

    watchBtn.addEventListener('click', async () => {
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      watchBtn.disabled = true;
      try {
        const result = await toggleWatchLater(id);
        updateWatchButton(result.watchLater);
        setStatus(result.watchLater ? 'Saved to Watch Later.' : 'Removed from Watch Later.', 'success');
        setTimeout(() => setStatus('Published and ready to watch.', 'success'), 1500);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        watchBtn.disabled = false;
      }
    });

    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      commentSubmit.disabled = true;
      commentSubmit.textContent = 'Posting...';
      try {
        const text = commentText.value.trim();
        if (!text) throw new Error('Please enter a comment.');
        await addComment(id, text);
        commentText.value = '';
        const latest = await fetchComments(id);
        renderComments(latest);
        setStatus('Comment posted!', 'success');
        setTimeout(() => setStatus('Published and ready to watch.', 'success'), 2000);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        commentSubmit.disabled = false;
        commentSubmit.textContent = 'Post comment';
      }
    });
  } catch (err) {
    loadingOverlay.style.display = 'none';
    setStatus(err.message, 'error');
    previewEl.innerHTML = '<p>Nothing to show.</p>';
    titleEl.textContent = 'Unavailable';
    descriptionEl.textContent = '';
    likeBtn.disabled = true;
    commentSubmit.disabled = true;
  }
}

init();
