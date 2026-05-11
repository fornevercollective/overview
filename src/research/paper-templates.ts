export type PaperGenre =
  | 'empirical_imrad'
  | 'review'
  | 'theoretical'
  | 'case_study'
  | 'general'

export const PAPER_GENRES: readonly PaperGenre[] = [
  'empirical_imrad',
  'review',
  'theoretical',
  'case_study',
  'general',
] as const

export type PaperGenreMode = 'auto' | PaperGenre

export const PAPER_GENRE_MODES: readonly PaperGenreMode[] = ['auto', ...PAPER_GENRES] as const

export function isPaperGenre(s: string): s is PaperGenre {
  return (PAPER_GENRES as readonly string[]).includes(s)
}

export function isPaperGenreMode(s: string): s is PaperGenreMode {
  return (PAPER_GENRE_MODES as readonly string[]).includes(s)
}

export type PaperSectionTemplate = {
  id: string
  title: string
  hintBody?: string
  children?: PaperSectionTemplate[]
}

export const PAPER_TEMPLATES: Record<PaperGenre, PaperSectionTemplate[]> = {
  empirical_imrad: [
    {
      id: 'intro',
      title: 'Introduction',
      hintBody: 'Research question, contributions, and paper roadmap.',
      children: [],
    },
    {
      id: 'related',
      title: 'Related work',
      hintBody: 'Position against closest prior methods and datasets.',
      children: [],
    },
    {
      id: 'methods',
      title: 'Methods',
      hintBody: 'Design, materials, procedure, measures, and analysis plan.',
      children: [],
    },
    {
      id: 'results',
      title: 'Results',
      hintBody: 'Primary outcomes with tables/figures references (no raw numbers here unless brief).',
      children: [],
    },
    {
      id: 'discussion',
      title: 'Discussion',
      hintBody: 'Interpretation, mechanisms, and comparison to hypotheses.',
      children: [],
    },
    {
      id: 'limitations',
      title: 'Limitations',
      hintBody: 'Threats to validity, scope, and generalization boundaries.',
      children: [],
    },
    {
      id: 'conclusion',
      title: 'Conclusion',
      hintBody: 'Takeaways and practical implications in one tight pass.',
      children: [],
    },
    {
      id: 'availability',
      title: 'Data / code availability',
      hintBody: 'Artifacts, licenses, and reproducibility pointers.',
      children: [],
    },
    { id: 'refs', title: 'References', hintBody: 'Citation list or bibliography notes.', children: [] },
  ],
  review: [
    {
      id: 'rintro',
      title: 'Introduction',
      hintBody: 'Scope, review questions, and inclusion boundaries.',
      children: [],
    },
    {
      id: 'background',
      title: 'Background',
      hintBody: 'Definitions, terminology, and problem setting.',
      children: [],
    },
    {
      id: 'synthesis',
      title: 'Thematic synthesis',
      hintBody: 'Group studies by theme; contrast methods and findings.',
      children: [],
    },
    {
      id: 'gaps',
      title: 'Gaps',
      hintBody: 'Conflicting evidence, under-explored settings, and weak evidence bases.',
      children: [],
    },
    {
      id: 'future',
      title: 'Future directions',
      hintBody: 'Open problems, measurement needs, and promising research lines.',
      children: [],
    },
    {
      id: 'rconcl',
      title: 'Conclusion',
      hintBody: 'Practitioner-facing summary and confidence overview.',
      children: [],
    },
    { id: 'rrefs', title: 'References', hintBody: 'Key sources and survey bibliography.', children: [] },
  ],
  theoretical: [
    {
      id: 'framing',
      title: 'Problem framing',
      hintBody: 'Formal question, assumptions, and notation overview.',
      children: [],
    },
    {
      id: 'defs',
      title: 'Definitions',
      hintBody: 'Objects, operators, and axioms used in the main argument.',
      children: [],
    },
    {
      id: 'main',
      title: 'Main argument',
      hintBody: 'Core claims, lemmas/theorems roadmap, proof sketches.',
      children: [],
    },
    {
      id: 'implications',
      title: 'Implications',
      hintBody: 'What changes if the results hold; limits of interpretation.',
      children: [],
    },
    {
      id: 'related-models',
      title: 'Related models',
      hintBody: 'Compare to adjacent formalisms and empirical bridges.',
      children: [],
    },
    {
      id: 'tconcl',
      title: 'Conclusion',
      hintBody: 'Summary of claims and open theoretical questions.',
      children: [],
    },
    { id: 'trefs', title: 'References', hintBody: 'Foundational citations.', children: [] },
  ],
  case_study: [
    {
      id: 'context',
      title: 'Context',
      hintBody: 'Setting, stakeholders, and why this case matters.',
      children: [],
    },
    {
      id: 'case',
      title: 'Case description',
      hintBody: 'Timeline, artifacts, and data sources (bounded narrative).',
      children: [],
    },
    {
      id: 'analysis',
      title: 'Analysis',
      hintBody: 'Analytic lens, coding scheme, or framework application.',
      children: [],
    },
    {
      id: 'findings',
      title: 'Findings',
      hintBody: 'Evidence-backed observations organized by claim.',
      children: [],
    },
    {
      id: 'lessons',
      title: 'Lessons',
      hintBody: 'Transferable insights and caveats for other settings.',
      children: [],
    },
    {
      id: 'cconcl',
      title: 'Conclusion',
      hintBody: 'Implications and what would falsify the narrative.',
      children: [],
    },
    { id: 'crefs', title: 'References', hintBody: 'Sources, interviews, and document refs.', children: [] },
  ],
  general: [
    {
      id: 'gctx',
      title: 'Context',
      hintBody: 'What problem, scope, and constraints matter for this pass?',
      children: [],
    },
    {
      id: 'gfind',
      title: 'Findings',
      hintBody: '',
      children: [
        {
          id: 'gprim',
          title: 'Primary sources',
          hintBody: '',
          children: [],
        },
      ],
    },
  ],
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

type WeightedKeyword = { w: number; patterns: RegExp[] }

const GENRE_PRIORITY = ['empirical_imrad', 'review', 'case_study', 'theoretical'] as const
type DetectablePaperGenre = (typeof GENRE_PRIORITY)[number]

const GENRE_KEYWORDS: Record<DetectablePaperGenre, WeightedKeyword[]> = {
  empirical_imrad: [
    { w: 3, patterns: [/\birb\b/, /\brct\b/, /\bpreregistered\b/, /\bpre-?registered\b/] },
    { w: 2, patterns: [/\bhypothesis\b/, /\bhypotheses\b/, /\bparticipants\b/, /\bsubjects\b/, /\bintervention\b/] },
    { w: 2, patterns: [/\brandomized\b/, /\bdouble-?blind\b/, /\bcontrol group\b/, /\bplacebo\b/] },
    { w: 2, patterns: [/\bmethods?\b/, /\bprocedure\b/, /\bdata collection\b/, /\binstrument\b/, /\bsurvey \(n=/] },
    { w: 1, patterns: [/\bp-?value\b/, /\beffect size\b/, /\bpower analysis\b/, /\banova\b/, /\bregression\b/] },
    { w: 1, patterns: [/\bexperiment\b/, /\btrial\b/, /\bempirical\b/, /\bdataset\b/, /\bground truth\b/] },
  ],
  review: [
    { w: 3, patterns: [/\bsystematic review\b/, /\bmeta-?analysis\b/, /\bliterature review\b/, /\bscoping review\b/] },
    { w: 2, patterns: [/\bsurvey of the literature\b/, /\bstate of the art\b/, /\bnarrative review\b/] },
    { w: 2, patterns: [/\bsynthesis of\b/, /\boverview of prior\b/, /\bprior work\b/, /\brelated studies\b/] },
    { w: 1, patterns: [/\bcorpus of papers\b/, /\bincluded studies\b/, /\bsearch strategy\b/, /\bprisma\b/] },
  ],
  theoretical: [
    { w: 3, patterns: [/\btheorem\b/, /\blemma\b/, /\bproposition\b/, /\bcorollary\b/] },
    { w: 2, patterns: [/\bproof sketch\b/, /\bformal model\b/, /\baxioms?\b/, /\bderivation\b/] },
    { w: 1, patterns: [/\bcomplexity class\b/, /\bnp-?hard\b/, /\binformation theory\b/, /\blower bound\b/] },
  ],
  case_study: [
    { w: 3, patterns: [/\bcase study\b/, /\bsingle case\b/, /\bn=1\b/, /\bethnography\b/] },
    { w: 2, patterns: [/\bsite visit\b/, /\borganization\b.*\bstudy\b/, /\bfield notes\b/] },
    { w: 1, patterns: [/\bqualitative\b.*\binterview\b/, /\bstakeholder\b.*\binterview\b/, /\bin-?depth interview\b/] },
  ],
}

/**
 * Lightweight keyword scoring for UI auto-mode. Deterministic; defaults to `general` when no genre clears the floor.
 */
export function detectPaperGenre(text: string): PaperGenre {
  const t = norm(text)
  if (!t) return 'general'

  const scores: Record<PaperGenre, number> = {
    empirical_imrad: 0,
    review: 0,
    theoretical: 0,
    case_study: 0,
    general: 0,
  }

  for (const g of GENRE_PRIORITY) {
    for (const { w, patterns } of GENRE_KEYWORDS[g]) {
      for (const re of patterns) {
        re.lastIndex = 0
        if (re.test(t)) scores[g] += w
      }
    }
  }

  const floor = 2
  let best: PaperGenre = 'general'
  let bestScore = 0
  for (const g of GENRE_PRIORITY) {
    if (scores[g] > bestScore) {
      bestScore = scores[g]
      best = g
    }
  }

  if (bestScore < floor) return 'general'
  return best
}

export { paperTemplateToSections } from './research-tree'
