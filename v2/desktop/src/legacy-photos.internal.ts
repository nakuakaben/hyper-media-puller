import extreme from '../../../assets/devices/hyperdeck-extreme-8k.png?no-inline'
import pro from '../../../assets/devices/hyperdeck-studio-4k-pro.png?no-inline'
import mini from '../../../assets/devices/hyperdeck-studio-hd-mini.png?no-inline'
import plus from '../../../assets/devices/hyperdeck-studio-hd-plus.png?no-inline'
import type { DeviceModel } from './device-model'

export const legacyPhotos: Record<DeviceModel, string> = {
  'extreme-8k': extreme,
  'studio-4k-pro': pro,
  'studio-hd-mini': mini,
  'studio-hd-plus': plus,
}
