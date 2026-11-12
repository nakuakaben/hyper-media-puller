import type { Media } from './contracts'
import rules from './system-files.json' with { type: 'json' }

function systemComponent(component: string): boolean {
  const name = component.toLowerCase()
  return rules.names.includes(name) || rules.prefixes.some(prefix => name.startsWith(prefix))
}

export function isSystemPath(path: string): boolean {
  return path.split('/').some(systemComponent)
}

export function visibleParent(path: string): string {
  const parts = path.split('/')
  const firstSystem = parts.findIndex(systemComponent)
  return firstSystem < 0 ? path : parts.slice(0, firstSystem).join('/') || '/'
}

export function selectableMedia(items: Media[]): Media[] {
  return items.filter(item => !item.directory && !isSystemPath(item.remote_path))
}
