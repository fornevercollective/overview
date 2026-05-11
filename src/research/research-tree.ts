import type { ResearchSection } from './research-types'

export function newSection(partial?: Partial<ResearchSection>): ResearchSection {
  return {
    id: crypto.randomUUID(),
    title: partial?.title ?? '',
    body: partial?.body ?? '',
    children: partial?.children ?? [],
  }
}

export function flattenOutline(
  sections: ResearchSection[],
  depth = 0,
): { id: string; title: string; depth: number }[] {
  const rows: { id: string; title: string; depth: number }[] = []
  for (const s of sections) {
    rows.push({ id: s.id, title: s.title.trim() || 'Untitled', depth })
    rows.push(...flattenOutline(s.children, depth + 1))
  }
  return rows
}

export function mapSection(
  sections: ResearchSection[],
  id: string,
  fn: (s: ResearchSection) => ResearchSection,
): ResearchSection[] {
  return sections.map((s) => {
    if (s.id === id) return fn(s)
    const nextChildren = mapSection(s.children, id, fn)
    if (nextChildren === s.children) return s
    return { ...s, children: nextChildren }
  })
}

export function addChild(
  sections: ResearchSection[],
  parentId: string,
  child: ResearchSection,
): ResearchSection[] {
  return mapSection(sections, parentId, (s) => ({
    ...s,
    children: [...s.children, child],
  }))
}

export function removeSection(sections: ResearchSection[], id: string): ResearchSection[] {
  return sections
    .filter((s) => s.id !== id)
    .map((s) => ({ ...s, children: removeSection(s.children, id) }))
}

export function collectPathTitles(
  sections: ResearchSection[],
  targetId: string,
  prefix: string[] = [],
): string[] | null {
  for (const s of sections) {
    const next = [...prefix, s.title]
    if (s.id === targetId) return next
    const found = collectPathTitles(s.children, targetId, next)
    if (found) return found
  }
  return null
}

export function findSection(
  sections: ResearchSection[],
  id: string,
): ResearchSection | null {
  for (const s of sections) {
    if (s.id === id) return s
    const inner = findSection(s.children, id)
    if (inner) return inner
  }
  return null
}
