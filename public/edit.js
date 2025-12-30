const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const publishBtn = document.getElementById('publish');

function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
}

function renderPreview(data) {
  previewEl.innerHTML = '';
  if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.fileUrl;
    img.alt = data.title || 'Upload preview';
    previewEl.appendChild(img);
  } else if (data.type === 'video') {
    const video = document.createElement('video');
    video.src = data.fileUrl;
    video.controls = true;
    previewEl.appendChild(video);
  } else {
    previewEl.textContent = 'Unsupported file type';
  }
}

async function fetchPost(id, token) {
  const response = await fetch(`/api/post/${id}?token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))).error || 'Unable to load draft';
    throw new Error(message);
  }
  return response.json();
}

async function publish(id, token, title, description) {
  const response = await fetch(`/api/post/${id}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, title, description })
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))).error || 'Failed to publish';
    throw new Error(message);
  }
  return response.json();
}

async function init() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const id = pathParts[pathParts.length - 1];
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    setStatus('Missing edit token in URL.', 'error');
    publishBtn.disabled = true;
    return;
  }

  try {
    setStatus('Loading draft…');
    const data = await fetchPost(id, token);
    renderPreview(data);
    titleInput.value = data.title || '';
    descriptionInput.value = data.description || '';
    publishBtn.disabled = false;
    publishBtn.addEventListener('click', async () => {
      publishBtn.disabled = true;
      setStatus('Publishing…');
      try {
        await publish(id, token, titleInput.value, descriptionInput.value);
        setStatus(`Published! View it at /post/${id}`, 'success');
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        publishBtn.disabled = false;
      }
    });
    setStatus('Ready to edit.');
  } catch (err) {
    setStatus(err.message, 'error');
    publishBtn.disabled = true;
  }
}

init();
