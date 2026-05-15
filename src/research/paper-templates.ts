export type PaperGenre =
  | 'empirical_imrad'
  | 'review'
  | 'theoretical'
  | 'case_study'
  | 'general'
  | 'screenplay'
  | 'book'
  | 'blog'
  | 'article'
  | 'social_thread'
  | 'tv_news'
  | 'podcast'
  | 'fiction'
  | 'nonfiction'
  | 'childrens_lit'
  | 'young_adult'
  | 'comic_script'
  | 'graphic_novel'
  | 'novella'
  | 'regional_structure'
  | 'word_order_typology'
  | 'lyrics_linguistics_corpus'

export const PAPER_GENRES: readonly PaperGenre[] = [
  'empirical_imrad',
  'review',
  'theoretical',
  'case_study',
  'general',
  'screenplay',
  'book',
  'blog',
  'article',
  'social_thread',
  'tv_news',
  'podcast',
  'fiction',
  'nonfiction',
  'childrens_lit',
  'young_adult',
  'comic_script',
  'graphic_novel',
  'novella',
  'regional_structure',
  'word_order_typology',
  'lyrics_linguistics_corpus',
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

/** Grouped labels for the genre `<select>` (excludes `auto`, which is rendered first). */
export type PaperGenreUiGroup = {
  label: string
  options: readonly { value: PaperGenre; label: string }[]
}

export const PAPER_GENRE_UI_GROUPS: readonly PaperGenreUiGroup[] = [
  {
    label: 'Scholarship',
    options: [
      { value: 'empirical_imrad', label: 'IMRaD (empirical)' },
      { value: 'review', label: 'Review' },
      { value: 'theoretical', label: 'Theoretical' },
      { value: 'case_study', label: 'Case study' },
    ],
  },
  {
    label: 'Story & script',
    options: [
      { value: 'screenplay', label: 'Script / screenplay' },
      { value: 'book', label: 'Book' },
    ],
  },
  {
    label: 'Fiction & nonfiction',
    options: [
      { value: 'fiction', label: 'Fiction (literary)' },
      { value: 'nonfiction', label: 'Nonfiction' },
    ],
  },
  {
    label: 'Audience',
    options: [
      { value: 'childrens_lit', label: "Children's" },
      { value: 'young_adult', label: 'Young adult (YA)' },
    ],
  },
  {
    label: 'Comics & novella',
    options: [
      { value: 'comic_script', label: 'Comic script' },
      { value: 'graphic_novel', label: 'Graphic novel' },
      { value: 'novella', label: 'Novella' },
    ],
  },
  {
    label: 'World, region & syntax',
    options: [
      { value: 'regional_structure', label: 'Regional / world narrative forms' },
      {
        value: 'word_order_typology',
        label: 'Clause word order (SVO · SOV · VSO · VOS · OVS · OSV · …)',
      },
    ],
  },
  {
    label: 'Publishing & social',
    options: [
      { value: 'blog', label: 'Blog post' },
      { value: 'article', label: 'Article / feature' },
      { value: 'social_thread', label: 'Social posts (thread outline)' },
    ],
  },
  {
    label: 'Broadcast & audio',
    options: [
      { value: 'tv_news', label: 'TV news segment' },
      { value: 'podcast', label: 'Podcast episode' },
    ],
  },
  {
    label: 'Music & corpus linguistics',
    options: [
      {
        value: 'lyrics_linguistics_corpus',
        label: 'Lyrics corpus · LM · diachronics · hooks',
      },
    ],
  },
  {
    label: 'General',
    options: [{ value: 'general', label: 'General' }],
  },
]

/** Flat list: Auto plus every genre (for hints and fallbacks). */
export const PAPER_GENRE_SELECT_OPTIONS: readonly { value: PaperGenreMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  ...PAPER_GENRE_UI_GROUPS.flatMap((g) => [...g.options]),
]

const arcAct1: PaperSectionTemplate[] = [
  { id: 'ordinary', title: 'Ordinary world', hintBody: 'Status quo, want vs need.', children: [] },
  { id: 'inciting', title: 'Inciting incident', hintBody: 'Disruption that demands response.', children: [] },
  { id: 'break2', title: 'Break into Act II', hintBody: 'Commitment; point of no return.', children: [] },
]

const arcAct2: PaperSectionTemplate[] = [
  { id: 'prog', title: 'Rising action', hintBody: 'Plans, complications, tests & allies.', children: [] },
  { id: 'mid', title: 'Midpoint', hintBody: 'Reversal or stakes shift (false victory/defeat).', children: [] },
  {
    id: 'alllost',
    title: 'Crisis & all is lost',
    hintBody: 'Darkest moment; forces a new approach.',
    children: [],
  },
  { id: 'break3', title: 'Break into Act III', hintBody: 'Final strategy; rally for climax.', children: [] },
]

const arcAct3: PaperSectionTemplate[] = [
  { id: 'climax', title: 'Climax', hintBody: 'Final confrontation; thematic proof.', children: [] },
  { id: 'denou', title: 'Resolution / denouement', hintBody: 'New equilibrium; emotional button.', children: [] },
]

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
  screenplay: [
    {
      id: 'sc_logline',
      title: 'Logline & theme',
      hintBody: 'One-line promise; moral question / genre frame.',
      children: [],
    },
    {
      id: 'sc_a1',
      title: 'Act I — Setup',
      hintBody: 'Three-act spine: introduce conflict and commitment.',
      children: [...arcAct1],
    },
    {
      id: 'sc_a2',
      title: 'Act II — Confrontation',
      hintBody: 'Escalation, midpoint, crisis; sustains tension.',
      children: [...arcAct2],
    },
    {
      id: 'sc_a3',
      title: 'Act III — Resolution',
      hintBody: 'Payoff, catharsis, closing image.',
      children: [...arcAct3],
    },
    {
      id: 'sc_notes',
      title: 'Production notes',
      hintBody: 'Sets, VFX, casting hooks, budget flags (optional).',
      children: [],
    },
  ],
  book: [
    {
      id: 'bk_premise',
      title: 'Premise & audience',
      hintBody: 'Shelf positioning, reader promise, tone.',
      children: [],
    },
    {
      id: 'bk_a1',
      title: 'Act I — Setup',
      hintBody: 'Part I: hook world, trigger, commitment.',
      children: [...arcAct1],
    },
    {
      id: 'bk_a2',
      title: 'Act II — Confrontation',
      hintBody: 'Part II: escalation, reversal, collapse.',
      children: [...arcAct2],
    },
    {
      id: 'bk_a3',
      title: 'Act III — Resolution',
      hintBody: 'Part III: climax, aftermath, thematic landing.',
      children: [...arcAct3],
    },
    {
      id: 'bk_beat',
      title: 'Chapter / beat map',
      hintBody: 'Rough chapter anchors or POV calendar.',
      children: [],
    },
  ],
  blog: [
    {
      id: 'bl_hook',
      title: 'Hook & promise',
      hintBody: 'Title tilt; what the reader gets if they stay.',
      children: [],
    },
    {
      id: 'bl_setup',
      title: 'Setup — stakes',
      hintBody: 'Problem frame; why it matters now.',
      children: [],
    },
    {
      id: 'bl_rise',
      title: 'Rising insight',
      hintBody: '',
      children: [
        { id: 'bl_obs', title: 'Observation', hintBody: 'Claim or lens.', children: [] },
        { id: 'bl_pf', title: 'Evidence & examples', hintBody: 'Stories, data, links.', children: [] },
        { id: 'bl_syn', title: 'Synthesis', hintBody: 'So what; connect dots.', children: [] },
      ],
    },
    {
      id: 'bl_close',
      title: 'Close — takeaway',
      hintBody: 'One-line thesis; optional CTA or question.',
      children: [],
    },
  ],
  article: [
    {
      id: 'ar_led',
      title: 'Lede & nut graf',
      hintBody: 'Grab; concise nut explaining why now.',
      children: [],
    },
    { id: 'ar_ctx', title: 'Context', hintBody: 'History, definitions, scope.', children: [] },
    {
      id: 'ar_dev',
      title: 'Development',
      hintBody: '',
      children: [
        { id: 'ar_thr', title: 'Through-line', hintBody: 'Main narrative spine.', children: [] },
        { id: 'ar_pf', title: 'Reporting beats', hintBody: 'Scenes, quotes, facts.', children: [] },
        { id: 'ar_nu', title: 'Counterpoint / nuance', hintBody: 'Objections, limits, competing views.', children: [] },
      ],
    },
    {
      id: 'ar_kick',
      title: 'Kicker',
      hintBody: 'Resonant closing chord; look ahead.',
      children: [],
    },
  ],
  social_thread: [
    {
      id: 'so_plan',
      title: 'Thread thesis',
      hintBody: 'One-sentence through-line for the whole thread.',
      children: [],
    },
    {
      id: 'so_p1',
      title: 'Post 1 — Hook',
      hintBody: 'Pattern interrupt; curiosity gap.',
      children: [],
    },
    {
      id: 'so_p2',
      title: 'Post 2 — Context',
      hintBody: 'Stakeholders, definitions, why you care.',
      children: [],
    },
    {
      id: 'so_p3',
      title: 'Post 3 — Tension / thesis',
      hintBody: 'Central claim; friction or insight.',
      children: [],
    },
    {
      id: 'so_p4',
      title: 'Post 4 — Proof ladder',
      hintBody: 'Evidence, examples, mini-stories.',
      children: [],
    },
    {
      id: 'so_p5',
      title: 'Post 5 — Payoff & CTA',
      hintBody: 'Synthesis; save/share/comment.',
      children: [],
    },
  ],
  tv_news: [
    {
      id: 'tv_tease',
      title: 'Cold open / tease',
      hintBody: 'Top-line promise; strongest VO or bites.',
      children: [],
    },
    {
      id: 'tv_intro',
      title: 'Anchor intro',
      hintBody: 'Signpost; toss to packages.',
      children: [],
    },
    {
      id: 'tv_pkg',
      title: 'Package / story body',
      hintBody: '',
      children: [
        { id: 'tv_track', title: 'Track / script', hintBody: 'VO, NAT, SUPERS.', children: [] },
        { id: 'tv_sot', title: 'Bites (SOT)', hintBody: 'Interview pulls; ID lines.', children: [] },
        { id: 'tv_br', title: 'B-roll beats', hintBody: 'Cover shots, maps, GFX.', children: [] },
      ],
    },
    {
      id: 'tv_bridge',
      title: 'Bridge / live',
      hintBody: 'Throw, stand-up, or toss to desk.',
      children: [],
    },
    {
      id: 'tv_tag',
      title: 'Tag / kicker',
      hintBody: 'Resolution, next step, sign-off.',
      children: [],
    },
  ],
  podcast: [
    {
      id: 'pd_tease',
      title: 'Cold open',
      hintBody: 'Tape or scripted hook; episode promise.',
      children: [],
    },
    {
      id: 'pd_intro',
      title: 'Intro — stakes',
      hintBody: 'Host intro; why listen; episode map.',
      children: [],
    },
    {
      id: 'pd_a1',
      title: 'Act I — Setup',
      hintBody: 'Exposition; question or mystery posed.',
      children: [...arcAct1],
    },
    {
      id: 'pd_a2',
      title: 'Act II — Investigation',
      hintBody: 'Interview beats, scenes, complications.',
      children: [
        ...arcAct2.map((n) => ({ ...n, id: `pd_${n.id}` })),
        {
          id: 'pd_midroll',
          title: 'Mid-roll / break (optional)',
          hintBody: 'Ad or station ID; reset listener.',
          children: [],
        },
      ],
    },
    {
      id: 'pd_a3',
      title: 'Act III — Payoff',
      hintBody: 'Answers, insights, takeaway.',
      children: [...arcAct3.map((n) => ({ ...n, id: `pd_${n.id}` }))],
    },
    {
      id: 'pd_out',
      title: 'Outro & credits',
      hintBody: 'CTA, plugs, thank-yous.',
      children: [],
    },
  ],
  fiction: [
    {
      id: 'fc_prem',
      title: 'Premise & POV',
      hintBody: 'Logline; voice, tense, and who holds the lens.',
      children: [],
    },
    {
      id: 'fc_char',
      title: 'Character spine',
      hintBody: 'Want vs need; flaw; relationship that applies pressure.',
      children: [],
    },
    {
      id: 'fc_a1',
      title: 'Act I — Setup',
      hintBody: 'World rules; desire; inciting disruption.',
      children: [...arcAct1.map((n) => ({ ...n, id: `fc_${n.id}` }))],
    },
    {
      id: 'fc_a2',
      title: 'Act II — Confrontation',
      hintBody: 'Escalation, reversal, cost of pursuit.',
      children: [...arcAct2.map((n) => ({ ...n, id: `fc_${n.id}` }))],
    },
    {
      id: 'fc_a3',
      title: 'Act III — Resolution',
      hintBody: 'Choice, climax, thematic echo.',
      children: [...arcAct3.map((n) => ({ ...n, id: `fc_${n.id}` }))],
    },
    {
      id: 'fc_theme',
      title: 'Theme & symbol',
      hintBody: 'Refrains, objects, and the question the ending answers.',
      children: [],
    },
  ],
  nonfiction: [
    {
      id: 'nf_prem',
      title: 'Thesis / promise',
      hintBody: 'What the reader learns; scope and exclusions.',
      children: [],
    },
    {
      id: 'nf_stake',
      title: 'Stakes & reader',
      hintBody: 'Why it matters now; who this is for.',
      children: [],
    },
    {
      id: 'nf_bg',
      title: 'Background & definitions',
      hintBody: 'Terms, history, or methods the reader needs first.',
      children: [],
    },
    {
      id: 'nf_body',
      title: 'Core chapters / movements',
      hintBody: '',
      children: [
        { id: 'nf_m1', title: 'Movement I — evidence', hintBody: 'Primary material, scenes, or data.', children: [] },
        { id: 'nf_m2', title: 'Movement II — analysis', hintBody: 'Interpretation and pattern-finding.', children: [] },
        { id: 'nf_m3', title: 'Movement III — synthesis', hintBody: 'So what; bridges to the thesis.', children: [] },
      ],
    },
    {
      id: 'nf_ctr',
      title: 'Counterarguments & limits',
      hintBody: 'Objections, scope caveats, what you are not claiming.',
      children: [],
    },
    {
      id: 'nf_end',
      title: 'Conclusion & onward',
      hintBody: 'Takeaways, implications, what to read or do next.',
      children: [],
    },
  ],
  childrens_lit: [
    {
      id: 'ch_hook',
      title: 'Hook / spread 1',
      hintBody: 'Instant tone; curiosity in one beat.',
      children: [],
    },
    {
      id: 'ch_want',
      title: 'Want (kid-sized)',
      hintBody: 'Clear desire; age-fit language.',
      children: [],
    },
    {
      id: 'ch_try',
      title: 'Try / fail (gentle tension)',
      hintBody: 'Attempts; humor or small stakes.',
      children: [],
    },
    {
      id: 'ch_turn',
      title: 'Turn / help',
      hintBody: 'Insight, kindness, or cleverness resolves block.',
      children: [],
    },
    {
      id: 'ch_out',
      title: 'Landing beat',
      hintBody: 'Warm close; optional refrain or call-back.',
      children: [],
    },
    {
      id: 'ch_theme',
      title: 'Theme (light touch)',
      hintBody: 'Moral or feeling without sermon.',
      children: [],
    },
  ],
  young_adult: [
    {
      id: 'ya_stakes',
      title: 'Identity stakes',
      hintBody: 'Self vs world — what belief or belonging is contested.',
      children: [],
    },
    {
      id: 'ya_a1',
      title: 'Act I — world & rupture',
      hintBody: 'Ordinary life; inciting force; choice to engage.',
      children: [...arcAct1.map((n) => ({ ...n, id: `ya_${n.id}` }))],
    },
    {
      id: 'ya_a2',
      title: 'Act II — pressure & midpoint',
      hintBody: 'Social cost; false victory/defeat; identity shift.',
      children: [...arcAct2.map((n) => ({ ...n, id: `ya_${n.id}` }))],
    },
    {
      id: 'ya_a3',
      title: 'Act III — agency & aftermath',
      hintBody: 'Active choice; consequence; new self-concept.',
      children: [...arcAct3.map((n) => ({ ...n, id: `ya_${n.id}` }))],
    },
    {
      id: 'ya_rel',
      title: 'Relationships lens',
      hintBody: 'Friend/mentor/family as mirrors for change.',
      children: [],
    },
  ],
  comic_script: [
    {
      id: 'cm_log',
      title: 'Issue / chapter logline',
      hintBody: 'One line; cliff or hook for the unit.',
      children: [],
    },
    {
      id: 'cm_page',
      title: 'Page breakdown',
      hintBody: '',
      children: [
        { id: 'cm_p1', title: 'Page / tier beats', hintBody: 'Grid, pacing, reveal placement.', children: [] },
        { id: 'cm_pan', title: 'Panels & flow', hintBody: 'read order; silent vs talky beats.', children: [] },
      ],
    },
    {
      id: 'cm_dialog',
      title: 'Dialogue & captions',
      hintBody: 'Balloons, SFX, narration boxes.',
      children: [],
    },
    {
      id: 'cm_vis',
      title: 'Visual direction',
      hintBody: 'key poses, backgrounds, continuity notes.',
      children: [],
    },
    {
      id: 'cm_lt',
      title: 'Lettering & design',
      hintBody: 'emphasis, SFX style, end-of-issue tag.',
      children: [],
    },
  ],
  graphic_novel: [
    {
      id: 'gn_arc',
      title: 'GN arc & theme',
      hintBody: 'Long-form question the book answers; image motifs.',
      children: [],
    },
    {
      id: 'gn_vol',
      title: 'Volume / act structure',
      hintBody: '',
      children: [
        {
          id: 'gn_a1',
          title: 'Act I — bind & break',
          hintBody: 'Establish rules; break them enticingly.',
          children: [...arcAct1.map((n) => ({ ...n, id: `gn1_${n.id}` }))],
        },
        {
          id: 'gn_a2',
          title: 'Act II — complication',
          hintBody: 'Depth, reversals, expand world.',
          children: [...arcAct2.map((n) => ({ ...n, id: `gn2_${n.id}` }))],
        },
        {
          id: 'gn_a3',
          title: 'Act III — resolve image',
          hintBody: 'Visual climax; closing tableaux.',
          children: [...arcAct3.map((n) => ({ ...n, id: `gn3_${n.id}` }))],
        },
      ],
    },
    {
      id: 'gn_sprd',
      title: 'Spread map (optional)',
      hintBody: 'Double-page moments; chapter breaks.',
      children: [],
    },
  ],
  novella: [
    {
      id: 'nv_one',
      title: 'Single-thread premise',
      hintBody: 'One central problem; minimal parallel plots.',
      children: [],
    },
    {
      id: 'nv_a1',
      title: 'Act I — tight setup',
      hintBody: 'Fast ordinary world; fast inciting.',
      children: [...arcAct1.map((n) => ({ ...n, id: `nv_${n.id}` }))],
    },
    {
      id: 'nv_a2',
      title: 'Act II — pressure chamber',
      hintBody: 'Compressed escalation; one major reversal.',
      children: [...arcAct2.map((n) => ({ ...n, id: `nv_${n.id}` }))],
    },
    {
      id: 'nv_a3',
      title: 'Act III — swift resolution',
      hintBody: 'Economy of scenes; echo opening image.',
      children: [...arcAct3.map((n) => ({ ...n, id: `nv_${n.id}` }))],
    },
    {
      id: 'nv_len',
      title: 'Length & scene budget',
      hintBody: 'Target word band; scene list cap.',
      children: [],
    },
  ],
  regional_structure: [
    {
      id: 'wr_pick',
      title: 'Primary narrative frame',
      hintBody: 'Pick the spine that matches locale, tradition, or publication expectation.',
      children: [],
    },
    {
      id: 'wr_kish',
      title: 'Ki-shō-ten-ketsu',
      hintBody: 'Introduction · development · twist · integration (non-confrontational turn).',
      children: [
        { id: 'wr_ki', title: 'Ki — introduction', hintBody: 'Establish elements without full conflict.', children: [] },
        { id: 'wr_sho', title: 'Shō — development', hintBody: 'Elaborate; deepen relationships / ideas.', children: [] },
        { id: 'wr_ten', title: 'Ten — twist / turn', hintBody: 'Reframe; surprise that changes meaning.', children: [] },
        { id: 'wr_ketsu', title: 'Ketsu — conclusion', hintBody: 'Harmonize; illuminate the twist.', children: [] },
      ],
    },
    {
      id: 'wr_ring',
      title: 'Ring / cyclical return',
      hintBody: 'Opening echoes closing; mythic or oral-traditional closure.',
      children: [],
    },
    {
      id: 'wr_west',
      title: 'Western three-act (reference)',
      hintBody: 'Optional overlay when market expects filmic structure.',
      children: [...arcAct1.map((n) => ({ ...n, id: `wr_w_${n.id}` })), ...arcAct2.map((n) => ({ ...n, id: `wr_w2_${n.id}` })), ...arcAct3.map((n) => ({ ...n, id: `wr_w3_${n.id}` }))],
    },
    {
      id: 'wr_oral',
      title: 'Oral / episodic cadence',
      hintBody: 'Repetition-with-variation; call-and-response; refrain.',
      children: [],
    },
    {
      id: 'wr_voice',
      title: 'Locale, language & audience',
      hintBody: 'Code-switching, untranslated terms, insider framing.',
      children: [],
    },
  ],
  word_order_typology: [
    {
      id: 'wo_lang',
      title: 'Language variety & material',
      hintBody: 'Dialect/register; prose vs verse; conlang doc vs linguistic analysis; corpus scope.',
      children: [],
    },
    {
      id: 'wo_dom',
      title: 'Dominant & alternate orders',
      hintBody: 'Which permutation is canonical in main clauses; frequency of marked orders.',
      children: [],
    },
    {
      id: 'wo_six',
      title: 'Six-way constituent matrix (S · V · O)',
      hintBody: 'Document how each order behaves: neutral vs emphatic, matrix vs embedded, main vs subordinate.',
      children: [
        {
          id: 'wo_svo',
          title: 'SVO — Subject · Verb · Object',
          hintBody: 'e.g. English-style branching; VO head direction for complements.',
          children: [],
        },
        {
          id: 'wo_sov',
          title: 'SOV — Subject · Object · Verb',
          hintBody: 'Verb-final root; left-branching tendencies; OV typology notes.',
          children: [],
        },
        {
          id: 'wo_vso',
          title: 'VSO — Verb · Subject · Object',
          hintBody: 'Verb-initial root; second-position phenomena if any.',
          children: [],
        },
        {
          id: 'wo_vos',
          title: 'VOS — Verb · Object · Subject',
          hintBody: 'Rare but attested; object-before-subject conditions.',
          children: [],
        },
        {
          id: 'wo_ovs',
          title: 'OVS — Object · Verb · Subject',
          hintBody: 'Highly marked; pragmatic or stylistic triggers.',
          children: [],
        },
        {
          id: 'wo_osv',
          title: 'OSV — Object · Subject · Verb',
          hintBody: 'Topic/object fronting; possible topic-prominent reading.',
          children: [],
        },
      ],
    },
    {
      id: 'wo_cfg',
      title: 'Configuration & notation',
      hintBody: 'Spell out hyphen forms (S-V-O), phrase-structure sketches, feature geometry if modeling.',
      children: [],
    },
    {
      id: 'wo_sate',
      title: 'Satellite phenomena',
      hintBody: '',
      children: [
        {
          id: 'wo_v2',
          title: 'Verb-second (V2) / verb placement',
          hintBody: 'Finite verb position relative to CP/TP edges; auxiliary placement.',
          children: [],
        },
        {
          id: 'wo_head',
          title: 'Head direction & branching',
          hintBody: 'OV vs VO correlates (AdjN vs NAdj, PP direction, etc.).',
          children: [],
        },
        {
          id: 'wo_topic',
          title: 'Topic–comment & information structure',
          hintBody: 'Contrastive topicalization, given vs new, focus particles.',
          children: [],
        },
        {
          id: 'wo_scram',
          title: 'Scrambling / free word order',
          hintBody: 'Permutation limits, A- vs A-Bar movement, discourse-conditioned orders.',
          children: [],
        },
      ],
    },
    {
      id: 'wo_style',
      title: 'Prose style vs canonical order',
      hintBody: 'When narrative rhythm inverts or mirrors OV/VO texture; translation equivalences.',
      children: [],
    },
  ],
  lyrics_linguistics_corpus: [
    {
      id: 'll_scope',
      title: 'Corpus scope, fame filter & rights',
      hintBody:
        'Chart eras, deduping, licensing; stable IDs (ISRC, MusicBrainz) for joins; explicit text-only vs MIDI/audio augmentation subset.',
      children: [],
    },
    {
      id: 'll_through',
      title: 'Linguistic substrate (through-line)',
      hintBody:
        'Lyrics as performable discourse: phonology/prosody proxies, morphosyntax, line-sensitive syntax, discourse roles (hook vs verse vs bridge).',
      children: [],
    },
    {
      id: 'll_lm',
      title: 'Text LM fine-tuning & surprisal',
      hintBody:
        'Objectives and splits; decade/genre conditioning (prefixes or adapters); section-aware heads; per-token surprisal as a memorability covariate.',
      children: [],
    },
    {
      id: 'll_prosody',
      title: 'Rhythm & meter from text (+ symbolic/audio bridge)',
      hintBody:
        'Syllables per line, stress templates, variance within sections; plan alignment of stressed syllables to strong beats when MIDI/tempo exists.',
      children: [],
    },
    {
      id: 'll_diachronic',
      title: 'Diachronic strata & genre structure',
      hintBody:
        'Time bins × genre/register; repetition and readability trends; embedding drift / semantic change; interactions (not only topic drift).',
      children: [],
    },
    {
      id: 'll_influence',
      title: 'Influence waves & intertextuality',
      hintBody:
        'Controlled phrase overlap; sampling/cover/collaboration graphs; separate borrow from high-frequency cliché baselines.',
      children: [],
    },
    {
      id: 'll_earworm',
      title: 'Memorability & earworm proxies (text notation)',
      hintBody:
        'Rhyme density, refrain repetition graphs, periodicity; LM surprisal on hooks; cite limits of text-only vs melodic earworm work.',
      children: [],
    },
    {
      id: 'll_cases',
      title: 'Famous-song case studies',
      hintBody: 'Annotated examples across eras; tie measurable features to narrative of influence and reception.',
      children: [],
    },
    {
      id: 'll_eval',
      title: 'Evaluation, ablations & ethics',
      hintBody: 'Held-out decades/genres; what breaks without audio; reproducibility; copyright posture for redistribution.',
      children: [],
    },
  ],
}

/** Menu copy: integrated pillars for lyrics × linguistics research (Genre & story format drawer). */
export const GENRE_LENS_LYRICS_LINGUISTICS_PILLARS: readonly { title: string; text: string }[] = [
  {
    title: 'Linguistic through-line',
    text: 'Phonology and prosody (stress, syllable weight), morphosyntax, syntax shaped by line breaks, and discourse roles—hook, verse, bridge—as rhetorical moves, not flat prose.',
  },
  {
    title: 'Text LM layer',
    text: 'Fine-tuning and surprisal quantify expectation; combine with explicit corpus features so "stickiness" is not only a black-box embedding.',
  },
  {
    title: 'Rhythmic scaffolding',
    text: 'Text-native meter proxies first; add MIDI or beat-aligned audio on a subset wherever you claim groove, syncopation, or stress-to-beat coupling.',
  },
  {
    title: 'History & genre waves',
    text: 'Diachronic bins and cross-genre register show how lexical choices and repetition move—not just which topics trend.',
  },
  {
    title: 'Influence & intertext',
    text: 'Phrase overlap and lineage graphs need controls for generic lines; metadata (covers, samples, credits) reduces false "influence".',
  },
  {
    title: 'Earworm notation (text side)',
    text: 'Parallel to melodic contour: stress-height sketches, rhyme schemes, refrain spacing, repetition graphs, and fluency—linked to memorability literature.',
  },
] as const

/** Shown under Genre & story format when syncing taxonomy from an external CLI. */
export const GENRE_STORY_FORMAT_CLI_SYNC_NOTE =
  'When your CLI grows the genre list: add literals to PaperGenre in paper-templates.ts, mirror this select + workspace snapshot schema enum, then re-export or merge snapshots.'

/** Extra seed instructions for `onAiIterate` backends (overview Ollama shim uses this). */
export function paperGenreSeedGuidance(genre: PaperGenre): string | undefined {
  if (genre !== 'lyrics_linguistics_corpus') return undefined
  return (
    'Scaffold discipline: lyrics are timed, repetitive discourse. ' +
    'Each major section should tie claims to (1) measurable linguistic features, (2) optional audio/MIDI alignment where rhythm is asserted, ' +
    '(3) diachronic or cross-genre comparison with explicit controls. ' +
    'Avoid prose-only storytelling without operational definitions.'
  )
}

/** Short hint on expand/refine when tab resolves to this scaffold genre. */
export function paperGenreIterateGuidance(genre: PaperGenre): string | undefined {
  if (genre !== 'lyrics_linguistics_corpus') return undefined
  return (
    'Scaffold genre lyrics_linguistics_corpus: add or tighten sections along the linguistic through-line ' +
    '(prosody, syntax, discourse role, diachronics/influence). Prefer measurable features and evaluation hooks over vague narrative.'
  )
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

type WeightedKeyword = { w: number; patterns: RegExp[] }

/** Higher-first tie-break: audience & format beats broad "book"; broadcast stays high-signal. */
const GENRE_PRIORITY = [
  'childrens_lit',
  'young_adult',
  'comic_script',
  'graphic_novel',
  'novella',
  'regional_structure',
  'word_order_typology',
  'lyrics_linguistics_corpus',
  'tv_news',
  'podcast',
  'screenplay',
  'social_thread',
  'empirical_imrad',
  'review',
  'case_study',
  'theoretical',
  'fiction',
  'nonfiction',
  'book',
  'blog',
  'article',
] as const
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
  screenplay: [
    { w: 3, patterns: [/\bscreenplay\b/, /\bteleplay\b/, /\bslug line\b/, /\bbeat sheet\b/] },
    { w: 2, patterns: [/\bfade in\b/, /\bcut to:\b/, /\b(?:int|ext)\./, /\bscene heading\b/] },
    { w: 1, patterns: [/\bstory beats?\b/, /\btreatment\b/, /\bthree-?act\b/] },
  ],
  book: [
    { w: 3, patterns: [/\bnovel\b/, /\bmanuscript\b/, /\bbook proposal\b/, /\bprologue\b/, /\bepilogue\b/] },
    { w: 2, patterns: [/\bchapter \d/, /\bchapter outline\b/, /\bnonfiction book\b/] },
    { w: 1, patterns: [/\bforeword\b/, /\bpart i\b.*\bpart ii\b/] },
  ],
  blog: [
    { w: 3, patterns: [/\bblog post\b/, /\bnewsletter issue\b/, /\bsubstack\b/] },
    { w: 2, patterns: [/\b800-?word\b/, /\blong-?form post\b/] },
    { w: 1, patterns: [/\bpersonal essay\b/, /\bop-?ed\b/] },
  ],
  article: [
    { w: 3, patterns: [/\bfeature story\b/, /\bnut graf\b/, /\blede\b/, /\blongform journalism\b/] },
    { w: 2, patterns: [/\bbyline\b/, /\bdateline\b/, /\beditor'?s note\b/] },
    { w: 1, patterns: [/\bmagazine feature\b/, /\bprofile piece\b/] },
  ],
  social_thread: [
    { w: 3, patterns: [/\bthread 🧵/, /\b1\/\s*\d+/, /\bsocial thread\b/, /\bcarousel post\b/] },
    { w: 2, patterns: [/\bthreads?\b.*\btwitter\b/, /\bmastodon thread\b/, /\bluesky thread\b/] },
    { w: 1, patterns: [/\bx thread\b/, /\bposting thread\b/] },
  ],
  tv_news: [
    { w: 3, patterns: [/\bbreaking news\b/, /\bnews package\b/, /\banchor desk\b/, /\brundown\b/] },
    { w: 2, patterns: [/\bb-?roll\b/, /\blive shot\b/, /\bcut to\b/, /\bsot\b/, /\bvoiceover\b/, /\bvo\b/] },
    { w: 1, patterns: [/\bsupers?\b/, /\bpackage script\b/, /\bnewsroom\b/] },
  ],
  podcast: [
    { w: 3, patterns: [/\bpodcast episode\b/, /\bshow notes\b/, /\bad read\b/, /\bmid-?roll\b/] },
    { w: 2, patterns: [/\bpodcast\b/, /\bcold open\b/, /\bintro music\b/] },
    { w: 1, patterns: [/\btranscript episode\b/, /\bepisode outline\b/] },
  ],
  fiction: [
    { w: 3, patterns: [/\bliterary fiction\b/, /\bgenre fiction\b/, /\bcharacter arc\b/, /\bplot outline\b/] },
    { w: 2, patterns: [/\bfiction draft\b/, /\bfictional\b/, /\bprotagonist\b/, /\bantagonist\b/] },
    { w: 1, patterns: [/\bthird person\b/, /\bfirst person\b.*\bnovel\b/, /\bsubplot\b/, /\bstakes\b.*\bcharacter\b/] },
  ],
  nonfiction: [
    { w: 3, patterns: [/\bnarrative nonfiction\b/, /\bnarrative non-?fiction\b/, /\bnonfiction book\b/, /\bnon-?fiction book\b/] },
    { w: 2, patterns: [/\bmemoir\b/, /\bbiography\b/, /\bessay collection\b/, /\bhistory book\b/, /\bpopular science\b/] },
    { w: 2, patterns: [/\breported\b/, /\bfact-?checked\b/, /\bprimary sources\b/] },
    { w: 1, patterns: [/\bgeneral audience nonfiction\b/, /\bcreative nonfiction\b/] },
  ],
  childrens_lit: [
    { w: 3, patterns: [/\bpicture book\b/, /\bchildren'?s book\b/, /\bchildrens book\b/, /\bearly reader\b/] },
    { w: 2, patterns: [/\bmiddle grade\b/, /\bmg fiction\b/, /\bchapter book\b/, /\bread-?aloud\b/] },
    { w: 2, patterns: [/\bbedtime story\b/, /\bage 4-8\b/, /\bages 3-7\b/, /\bboard book\b/] },
    { w: 1, patterns: [/\bkids'\s*book\b/, /\bjuvenile fiction\b/] },
  ],
  young_adult: [
    { w: 3, patterns: [/\byoung adult novel\b/, /\byoung adult fiction\b/, /\bya novel\b/, /\bya fiction\b/] },
    { w: 2, patterns: [/\byoung adult\b/, /\bya fantasy\b/, /\bya romance\b/, /\bteen pov\b/] },
    { w: 1, patterns: [/\bhigh school arc\b/, /\bcoming-?of-?age\b.*\bteen\b/, /\bnew adult\b/] },
  ],
  comic_script: [
    { w: 3, patterns: [/\bcomic script\b/, /\bgraphic script\b/, /\bword balloon\b/, /\bword balloons\b/] },
    { w: 2, patterns: [/\bsplash page\b/, /\bpanel \d/, /\btier \d/, /\bsequential script\b/] },
    { w: 1, patterns: [/\bpage turn reveal\b/, /\blettering notes\b/, /\bcomic book script\b/] },
  ],
  graphic_novel: [
    { w: 3, patterns: [/\bgraphic novel\b/, /\bgraphic novel outline\b/, /\bgn manuscript\b/] },
    { w: 2, patterns: [/\bsequential art\b/, /\bcomics medium\b/, /\bdouble-?page spread\b/] },
    { w: 1, patterns: [/\btrade paperback\b.*\bgraphic\b/] },
  ],
  novella: [
    { w: 4, patterns: [/\bnovella\b/, /\bnovelette\b/] },
    { w: 2, patterns: [/\b20,?\d{3}\s*words\b/, /\b15,?\d{3}\s*words\b/, /\b30k words\b/, /\b40k words\b/] },
    { w: 1, patterns: [/\bshort novel\b/, /\bsingle plot thread\b/] },
  ],
  regional_structure: [
    {
      w: 3,
      patterns: [/\bkishotenketsu\b/, /\bkishōtenketsu\b/, /\bki[\s-]sho[\s-]ten[\s-]ketsu\b/, /\b四幕\b/],
    },
    { w: 2, patterns: [/\bring composition\b/, /\bcyclical structure\b/, /\boral tradition\b.*\bnarrative\b/] },
    { w: 2, patterns: [/\bworld literature\b/, /\bpostcolonial narrative\b/, /\bregional narrative form\b/, /\bindigenous storytelling\b/] },
    { w: 1, patterns: [/\bnon-?western structure\b/, /\bcultural narrative beat\b/, /\blocal story form\b/] },
  ],
  word_order_typology: [
    {
      w: 4,
      patterns: [
        /\bsvo\b/,
        /\bsov\b/,
        /\bvso\b/,
        /\bvos\b/,
        /\bovs\b/,
        /\bosv\b/,
        /\bs-v-o\b/,
        /\bs-o-v\b/,
        /\bv-s-o\b/,
        /\bv-o-s\b/,
        /\bo-v-s\b/,
        /\bo-s-v\b/,
      ],
    },
    {
      w: 3,
      patterns: [
        /\bword order\b/,
        /\bconstituent order\b/,
        /\bbasic word order\b/,
        /\bcanonical order\b/,
        /\bclause order\b/,
        /\bclausal configuration\b/,
      ],
    },
    {
      w: 2,
      patterns: [
        /\bOV language\b/,
        /\bVO language\b/,
        /\bverb-?final\b/,
        /\bverb-?initial\b/,
        /\bverb-?second\b/,
        /\bverb second\b/,
        /\bOV typology\b/,
        /\bhead-?final\b/,
        /\bhead-?initial\b/,
      ],
    },
    {
      w: 2,
      patterns: [/\bv2\b/, /\btopic-?comment\b/, /\btopic prominent\b/, /\bscrambling\b/, /\binformation structure\b/],
    },
    { w: 1, patterns: [/\bmorphosyntax\b/, /\blinearization\b/, /\bconstituent structure\b/] },
  ],
  lyrics_linguistics_corpus: [
    {
      w: 4,
      patterns: [
        /\blyrics?\s+corpus\b/,
        /\bsong lyrics\b/,
        /\bchart (?:hits?|songs?)\b.*\blyrics?\b/,
        /\bpop lyrics\b/,
        /\blyrics?\s+fine[- ]?tuning\b/i,
      ],
    },
    {
      w: 3,
      patterns: [
        /\bdiachronic\b.*\blyrics?\b/,
        /\blyrics?\b.*\bdiachronic\b/,
        /\bearworm\b/,
        /\binvoluntary musical imagery\b/,
        /\bmillion song dataset\b/,
        /\bmusixmatch\b/,
      ],
    },
    {
      w: 2,
      patterns: [
        /\bverse\b.*\bchorus\b/,
        /\bhook\b.*\blyrics?\b/,
        /\blyrics?\b.*\bhook\b/,
        /\brhyme scheme\b/,
        /\bprosody\b.*\blyrics?\b/,
        /\bsyllable stress\b/,
        /\blm surprisal\b/,
        /\bsurprisal\b.*\blyrics?\b/,
      ],
    },
    {
      w: 2,
      patterns: [
        /\blinguistic through[- ]line\b/,
        /\bcorpus linguistics\b.*\bmusic\b/,
        /\bmusic\b.*\bcorpus linguistics\b/,
        /\binfluence waves\b.*\blyrics?\b/,
        /\bintertextuality\b.*\bsong\b/,
      ],
    },
    { w: 1, patterns: [/\bmeter\b.*\blyrics?\b/, /\brepetition\b.*\bchart\b/, /\blexical drift\b.*\bgenre\b/] },
  ],
}

/**
 * Lightweight keyword scoring for UI auto-mode. Deterministic; defaults to `general` when no genre clears the floor.
 */
export function detectPaperGenre(text: string): PaperGenre {
  const t = norm(text)
  if (!t) return 'general'

  const scores = {
    empirical_imrad: 0,
    review: 0,
    theoretical: 0,
    case_study: 0,
    general: 0,
    screenplay: 0,
    book: 0,
    blog: 0,
    article: 0,
    social_thread: 0,
    tv_news: 0,
    podcast: 0,
    fiction: 0,
    nonfiction: 0,
    childrens_lit: 0,
    young_adult: 0,
    comic_script: 0,
    graphic_novel: 0,
    novella: 0,
    regional_structure: 0,
    word_order_typology: 0,
    lyrics_linguistics_corpus: 0,
  } satisfies Record<PaperGenre, number>

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
