import extreme from './device-thumbnails/extreme-8k.png'
import pro from './device-thumbnails/studio-4k-pro.png'
import mini from './device-thumbnails/studio-hd-mini.png'
import plus from './device-thumbnails/studio-hd-plus.png'

export const deviceImages: Readonly<Partial<Record<string, string>>> = {
  'hyperdeck extreme 8k': extreme,
  'hyperdeck extreme 8k hdr': extreme,
  'hyperdeck studio 4k pro': pro,
  'hyperdeck studio hd mini': mini,
  'hyperdeck studio hd plus': plus,
}
