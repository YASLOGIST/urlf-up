import { showToast } from './ui.js'
import { t } from './app/strings.js'

const MAX_INPUT_BYTES = 10_000_000
const MAX_OUTPUT_BYTES = 250_000
const AVATAR_SIZE = 256
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function _canvasToBlob(canvas) {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Avatar encoding failed'))),
      'image/webp',
      0.85,
    )
  })
}

/** Resize and centre-crop an avatar without assuming OffscreenCanvas support.
 * Safari (and therefore the Capacitor iOS shell) uses the HTML canvas path. */
export async function resizeAvatar(file) {
  if (!ACCEPTED_TYPES.has(file?.type)) throw new Error('format')
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error('size')

  const bitmap = await createImageBitmap(file)
  try {
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(AVATAR_SIZE, AVATAR_SIZE)
      : Object.assign(document.createElement('canvas'), {
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
        })
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')

    const side = Math.min(bitmap.width, bitmap.height)
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )

    const blob = await _canvasToBlob(canvas)
    if (blob.size > MAX_OUTPUT_BYTES) throw new Error('size')
    return blob
  } finally {
    bitmap.close?.()
  }
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
  let objectUrl = null

  function _setPreview(value) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = null
    }
    const preview = value instanceof Blob ? (objectUrl = URL.createObjectURL(value)) : value
    if (preview) {
      img.src = preview
      img.hidden = false
      if (placeholder) placeholder.hidden = true
      if (btnRemove) btnRemove.hidden = false
      zone.dataset.mode = 'filled'
    } else {
      img.removeAttribute('src')
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
    if (!ACCEPTED_TYPES.has(file.type)) {
      showToast({ type: 'error', message: t('avatar.error.format') })
      return
    }
    try {
      const blob = await resizeAvatar(file)
      _setPreview(blob)
      onchange(blob)
    } catch (err) {
      const key = err.message === 'size' ? 'avatar.error.size' : 'avatar.error.upload'
      showToast({ type: 'error', message: t(key) })
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
    if (!/^https:\/\//i.test(raw)) {
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
