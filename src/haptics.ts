import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export async function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium') {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[style] });
    } else {
      navigator.vibrate?.({ light: 30, medium: 50, heavy: 100 }[style]);
    }
  } catch { /* ignore */ }
}

export async function hapticNotification(type: 'success' | 'warning' | 'error' = 'success') {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.notification({ type: { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }[type] });
    } else {
      navigator.vibrate?.([100, 50, 100]);
    }
  } catch { /* ignore */ }
}

export async function hapticSelection() {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
    } else {
      navigator.vibrate?.(10);
    }
  } catch { /* ignore */ }
}
