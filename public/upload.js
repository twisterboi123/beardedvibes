const form = document.getElementById('upload-form');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const uploadBtn = document.getElementById('upload-btn');
const sessionPill = document.getElementById('session-pill');
const logoutBtn = document.getElementById('logout-btn');
const homeBtn = document.getElementById('home-btn');
const fileInput = document.getElementById('file');
const fileLabel = document.getElementById('file-label');
const dropzone = document.getElementById('dropzone');
const publishCheckbox = document.getElementById('publish-now');

homeBtn.addEventListener('click', () => window.location.href = '/');
logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  if (e.dataTransfer.files?.length) {
    fileInput.files = e.dataTransfer.files;
    fileLabel.textContent = e.dataTransfer.files[0].name;
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) {
    fileLabel.textContent = fileInput.files[0].name;
  } else {
    fileLabel.textContent = 'Drag & drop or click to choose (mp4, webm, jpg, png, webp)';
  }
});

function setStatus(text, type = 'info') {
  statusEl.style.display = 'block';
  statusEl.textContent = text;
  statusEl.className = `status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
}

function setResult({ status, editLink, token, viewLink }) {
  resultEl.style.display = 'block';
  if (status === 'published') {
    resultEl.innerHTML = `Published! <a href="${viewLink}" target="_blank">View post</a>.`;
  } else {
    resultEl.innerHTML = `Draft saved. <a href="${editLink}" target="_blank">Open edit page</a> (token auto-included).`;
  }
}

async function ensureSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.user) throw new Error();
    sessionPill.textContent = `Signed in as ${data.user.username}`;
    logoutBtn.style.display = 'inline-flex';
  } catch (_err) {
    sessionPill.textContent = 'Sign in with Discord to upload';
    window.location.href = '/api/auth/login';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('Choose a file to upload.', 'error');
    return;
  }

  const format = (new FormData(form)).get('format') === 'short' ? 'short' : 'long';
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);
  formData.append('title', form.title.value);
  formData.append('description', form.description.value);
  formData.append('publish', publishCheckbox.checked ? 'true' : 'false');

  uploadBtn.disabled = true;
  setStatus('Uploading…');
  resultEl.style.display = 'none';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || 'Upload failed';
      throw new Error(msg);
    }
    const data = await res.json();
    const editLink = `/edit/${data.id}?token=${data.editToken}`;
    const viewLink = `/post/${data.id}`;
    if (data.status === 'published') {
      setStatus('Uploaded and published!', 'success');
    } else {
      setStatus('Upload saved as draft. Edit and publish next.', 'success');
    }
    setResult({ status: data.status, editLink, token: data.editToken, viewLink });
    form.reset();
    fileLabel.textContent = 'Drag & drop or click to choose (mp4, webm, jpg, png, webp)';
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

ensureSession();
