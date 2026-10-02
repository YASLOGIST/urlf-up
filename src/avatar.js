import { showToast } from './ui.js'
import { t } from './app/strings.js'

const MAX_OUTPUT_BYTES = 1_000_000 // 1MB post-compression hard cap

async function _resizeToBase64(file) {
  const bitmap = await createImageBitmap(file)
  const SIZE = 256
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d')

  // Center-crop to square
  const s = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - s) / 2
  const sy = (bitmap.height - s) / 2
  ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, SIZE, SIZE)

  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error(`Compressed image too large: ${(blob.size / 1024).toFixed(0)}KB (max 1000KB)`)
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function _probeUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(url)
    img.onerror = () => reject(new Error('URL did not load a valid image'))
    img.src = url
  })
}

export function initAvatarZone(zone, { onchange }) {
  if (!zone) return

  const circle = zone.querySelector('.avatar-circle')
  const img = zone.querySelector('.avatar-img')
  const placeholder = zone.querySelector('.avatar-placeholder')
  const fileInput = zone.querySelector('input[type=file]')
  const urlInput = zone.querySelector('input[type=url]')
  const btnUpload = zone.querySelector('[data-action=upload]')
  const btnUrl = zone.querySelector('[data-action=url]')
  const btnRemove = zone.querySelector('[data-action=remove]')

  function _setPreview(dataUrl) {
    if (dataUrl) {
      img.src = dataUrl
      img.hidden = false
      if (placeholder) placeholder.hidden = true
      if (btnRemove) btnRemove.hidden = false
      zone.dataset.mode = 'filled'
    } else {
      img.src = ''
      img.hidden = true
      if (placeholder) placeholder.hidden = false
      if (btnRemove) btnRemove.hidden = true
      zone.dataset.mode = 'empty'
    }
  }

  btnUpload?.addEventListener('click', () => fileInput?.click())

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast({ type: 'error', message: t('avatar.error.format') })
      return
    }
    try {
      const dataUrl = await _resizeToBase64(file)
      _setPreview(dataUrl)
      onchange(dataUrl)
    } catch (err) {
      showToast({ type: 'error', message: err.message || t('avatar.error.upload') })
    } finally {
      fileInput.value = ''
    }
  })

  btnUrl?.addEventListener('click', () => {
    if (urlInput) {
      urlInput.hidden = !urlInput.hidden
      if (!urlInput.hidden) urlInput.focus()
    }
  })

  urlInput?.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return
    const raw = urlInput.value.trim()
    if (!raw) return
    if (!/^https?:\/\//i.test(raw)) {
      showToast({ type: 'error', message: t('avatar.error.https') })
      return
    }
    try {
      const verified = await _probeUrl(raw)
      _setPreview(verified)
      onchange(verified)
      urlInput.hidden = true
      urlInput.value = ''
    } catch {
      showToast({ type: 'error', message: t('avatar.error.load') })
    }
  })

  btnRemove?.addEventListener('click', () => {
    _setPreview(null)
    onchange(null)
  })

  circle?.addEventListener('click', () => fileInput?.click())

  return { setPreview: _setPreview }
}
