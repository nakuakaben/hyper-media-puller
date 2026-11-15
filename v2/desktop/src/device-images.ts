import extreme from './device-thumbnails/extreme-8k.png?no-inline'
import pro from './device-thumbnails/studio-4k-pro.png?no-inline'
import mini from './device-thumbnails/studio-hd-mini.png?no-inline'
import plus from './device-thumbnails/studio-hd-plus.png?no-inline'
import { legacyPhotos } from '@legacy-photos'
import { deviceModel, type DeviceModel } from './device-model'

const illustrations: Record<DeviceModel, string> = {
  'extreme-8k': extreme,
  'studio-4k-pro': pro,
  'studio-hd-mini': mini,
  'studio-hd-plus': plus,
}

export function thumbnailSources(model: string) {
  const key = deviceModel(model)
  if (!key) return { illustration: undefined, photo: undefined }
  return { illustration: illustrations[key], photo: legacyPhotos?.[key] }
}
