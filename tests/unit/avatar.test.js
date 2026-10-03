import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeAvatar } from '../../src/avatar.js';

const originalOffscreenCanvas = globalThis.OffscreenCanvas;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

afterEach(() => {
  globalThis.OffscreenCanvas = originalOffscreenCanvas;
  globalThis.createImageBitmap = originalCreateImageBitmap;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
});

describe('avatar processing', () => {
  it('rejects unsupported formats and oversized inputs before decoding', async () => {
    globalThis.createImageBitmap = vi.fn();
    await expect(resizeAvatar(new File(['x'], 'face.gif', { type: 'image/gif' }))).rejects.toThrow('format');
    const huge = { type: 'image/jpeg', size: 10_000_001 };
    await expect(resizeAvatar(huge)).rejects.toThrow('size');
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('uses an HTML canvas fallback and releases the decoded bitmap', async () => {
    globalThis.OffscreenCanvas = undefined;
    const close = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 800, height: 600, close });
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(['webp'], { type: 'image/webp' }));
    });

    const output = await resizeAvatar(new File(['image'], 'face.jpg', { type: 'image/jpeg' }));

    expect(output.type).toBe('image/webp');
    expect(output.size).toBeLessThanOrEqual(250_000);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
