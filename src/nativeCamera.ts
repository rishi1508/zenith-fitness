import { Capacitor } from '@capacitor/core';
import { Camera, CameraErrorCode, MediaTypeSelection } from '@capacitor/camera';

/**
 * Taking a photo on Android, the way that does not kill the app.
 *
 * The old path was `<input type="file" capture="environment">`. In a
 * Capacitor WebView that hands the whole screen to the system camera app,
 * and two things go wrong:
 *   1. this app declares `android.permission.CAMERA` in its manifest, and
 *      Android then *requires* the runtime grant before an image-capture
 *      intent may start — without it the launch throws and the app dies;
 *   2. the camera app is memory-hungry, so Android often destroys our
 *      activity behind it. The WebView comes back cold — from the user's
 *      side, the app "crashed" and the photo is gone.
 *
 * `@capacitor/camera` fixes both: it owns the permission prompt, and the
 * Capacitor bridge saves and restores the pending plugin call across an
 * activity that was recreated. It also writes an already-downscaled file,
 * so the 12 MP original never has to be decoded in the WebView at all.
 *
 * On the web there is no plugin worth using — `nativePhotoCapture()` says
 * so and the caller keeps its `<input>`.
 */

/** Longest edge the OS hands back. Comfortably above the 1024 px the food
 *  scanner sends, so the resize below is still doing the final framing. */
const CAPTURE_PX = 1600;
const JPEG_QUALITY = 85;

/** True when the plugin should be used instead of an `<input type="file">`. */
export function nativePhotoCapture(): boolean {
  return Capacitor.isNativePlatform();
}

export class PhotoCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'PhotoCancelled';
  }
}

const CANCELLED: string[] = [
  CameraErrorCode.TakePhotoCancelled,
  CameraErrorCode.ChooseMediaCancelled,
];

/**
 * Take a photo (or pick one) and return it as a Blob the rest of the app
 * can treat exactly like a `File` from an `<input>`.
 *
 * Throws `PhotoCancelled` when the user backed out — callers should treat
 * that as "nothing happened", not as an error worth showing.
 */
export async function capturePhoto(source: 'camera' | 'gallery'): Promise<Blob> {
  try {
    // Ask before launching. The plugin would prompt anyway, but doing it here
    // means the grant is settled BEFORE any capture intent starts — the exact
    // sequence whose absence used to take the process down — and a refusal
    // becomes a sentence the user can act on instead of a dead button.
    const need = source === 'camera' ? 'camera' : 'photos';
    const status = await Camera.checkPermissions().catch(() => null);
    if (status && status[need] !== 'granted' && status[need] !== 'limited') {
      const asked = await Camera.requestPermissions({ permissions: [need] });
      if (asked[need] !== 'granted' && asked[need] !== 'limited') {
        throw new Error(source === 'camera'
          ? 'Camera access is off for Zenith. Turn it on in Android settings and try again.'
          : 'Photo access is off for Zenith. Turn it on in Android settings and try again.');
      }
    }

    const result = source === 'camera'
      ? await Camera.takePhoto({
        quality: JPEG_QUALITY,
        targetWidth: CAPTURE_PX,
        targetHeight: CAPTURE_PX,
        correctOrientation: true,
        saveToGallery: false,
      })
      : (await Camera.chooseFromGallery({
        mediaType: MediaTypeSelection.Photo,
        allowMultipleSelection: false,
        quality: JPEG_QUALITY,
        targetWidth: CAPTURE_PX,
        targetHeight: CAPTURE_PX,
      })).results[0];

    if (!result) throw new PhotoCancelled();
    const src = result.webPath ?? (result.uri ? Capacitor.convertFileSrc(result.uri) : null);
    if (!src) throw new Error('The camera returned nothing we can read.');
    const response = await fetch(src);
    if (!response.ok) throw new Error('That photo could not be read back.');
    return await response.blob();
  } catch (err) {
    if (err instanceof PhotoCancelled) throw err;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : '';
    if ((code && CANCELLED.includes(code)) || /cancel/i.test(message)) throw new PhotoCancelled();
    if (code === CameraErrorCode.CameraPermissionDenied) {
      throw new Error('Camera access is off for Zenith. Turn it on in Android settings and try again.');
    }
    if (code === CameraErrorCode.GalleryPermissionDenied) {
      throw new Error('Photo access is off for Zenith. Turn it on in Android settings and try again.');
    }
    throw err instanceof Error ? err : new Error('The camera could not be opened.');
  }
}
