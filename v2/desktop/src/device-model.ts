export type DeviceModel = 'extreme-8k' | 'studio-4k-pro' | 'studio-hd-mini' | 'studio-hd-plus'
export type ThumbnailStyle = 'generic' | 'legacy'

export function deviceModel(model: string): DeviceModel | undefined {
  const name = model.toLowerCase().replace(/[\s_-]+/g, ' ').trim().replace(/^blackmagic(?: design)? /, '')
  switch (name) {
    case 'hyperdeck extreme 8k':
    case 'hyperdeck extreme 8k hdr': return 'extreme-8k'
    case 'hyperdeck studio 4k pro': return 'studio-4k-pro'
    case 'hyperdeck studio hd mini': return 'studio-hd-mini'
    case 'hyperdeck studio hd plus': return 'studio-hd-plus'
  }
}
