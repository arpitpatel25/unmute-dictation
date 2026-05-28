export default function Voice() {
  return (
    <div className="max-w-2xl pb-12">
      <h2 className="font-display text-[22px] font-bold text-ink tracking-tight mb-1">Voice</h2>
      <p className="text-[13px] text-ink-35 mb-6">Dictate, instruct, and chain — all from your keyboard.</p>

      {/* Intro callout */}
      <div className="bg-ink rounded-2xl p-6 mb-5 shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.04)_0%,transparent_50%)] pointer-events-none" />
        <p className="text-[13px] text-white/65 leading-relaxed relative">
          Unmute works through <strong className="text-white font-bold">two physical keys</strong> on your keyboard.
          Everything flows from there — dictation, instructions, and chaining.
          No switching apps, no clicking buttons. Just keys.
        </p>
        <div className="flex items-center gap-2 mt-4 flex-wrap relative">
          <KeyBadgeHero>Fn</KeyBadgeHero>
          <span className="text-[11px] text-white/35">dictation</span>
          <span className="text-white/20 mx-1">·</span>
          <KeyBadgeHero variant="red">Control</KeyBadgeHero>
          <span className="text-[11px] text-white/35">instruction</span>
        </div>
      </div>

      {/* Mode 1: Pure Dictation */}
      <ModeCard
        number={1}
        accentColor="ink"
        title="Pure Dictation"
        subtitle="Speak anywhere, text appears at your cursor"
        trigger={<KeyBadge>Fn</KeyBadge>}
        description={<>The fastest way to get text into any app — Slack, email, Notion, code editors, anywhere. Tap <strong>Fn</strong> to start, speak naturally, tap again to stop. Your words appear exactly where your cursor is, transcribed in real time.</>}
        steps={[
          'Click into any text field in any app',
          <><strong>Tap Fn</strong> — the recording pill appears at the top of your screen</>,
          'Speak naturally at your normal pace',
          <><strong>Tap Fn again</strong> — text is pasted at your cursor instantly</>,
        ]}
        example="Hey, just wanted to follow up on that PR I sent over yesterday..."
        tags={['Slack messages', 'Email replies', 'Notion docs', 'Code comments', 'Any text field']}
      />

      {/* Mode 2: AI Instruction */}
      <ModeCard
        number={2}
        accentColor="accent"
        title="AI Instruction"
        subtitle="Tell the AI what to do — with or without selected text"
        trigger={<KeyBadge variant="dark">Control</KeyBadge>}
        description={<>Instead of transcribing your voice, Unmute treats your speech as an instruction to an AI. This is incredibly powerful when combined with text selection — select text first, then speak your command.</>}
        steps={[
          'Select the text you want to work with (or leave nothing selected for a fresh generation)',
          <><strong>Tap Control</strong> — the pill switches to instruction mode (red)</>,
          'Speak your instruction naturally',
          <><strong>Tap Control again</strong> — AI output replaces your selection</>,
        ]}
        example="Make this more professional and cut it by half"
        tags={['Rewrite text', 'Translate', 'Fix grammar', 'Change tone', 'Generate from scratch']}
        accentTags
      >
        {/* Text selection sub-workflows */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="text-[9px] font-bold text-ink-35 uppercase tracking-[0.12em] mb-3">With selected text</div>
          <div className="flex flex-col gap-2.5">
            <SubWorkflow
              icon="💬"
              title="Reply & Generate"
              description="Select an email or message, then tell the AI how to reply."
              example={'Select email → Control → "reply saying I won\'t be able to attend the meeting on Friday"'}
              result="AI generates a complete, polished reply based on the context."
            />
            <SubWorkflow
              icon="✏️"
              title="Edit in Place"
              description="Select text and ask the AI to make specific changes."
              example='Select paragraph → Control → "change the date to next Friday and make it shorter"'
              result="AI edits the selected text with your requested changes."
            />
            <SubWorkflow
              icon="📝"
              title="Quote & Discuss"
              description="Select text, then press Fn to dictate a response below it."
              example='Select a code review comment → Fn → "I agree, let me refactor that section"'
              result="Your dictation appears below the selected text as a contextual reply."
            />
          </div>
        </div>
      </ModeCard>

      {/* Mode 3: Chaining */}
      <ModeCard
        number={3}
        accentColor="gold"
        title="Dictate → Instruct (Chaining)"
        subtitle="Speak your thought, then shape it with AI — in one flow"
        trigger={
          <div className="flex items-center gap-1.5">
            <KeyBadge>Fn</KeyBadge>
            <span className="text-[10px] text-ink-35">→</span>
            <KeyBadge variant="dark">Ctrl</KeyBadge>
          </div>
        }
        description={<>The most powerful mode. Dictate a rough thought with <strong>Fn</strong>, then immediately tap <strong>Control</strong> and tell the AI how to shape it. Your raw voice becomes polished output in one breath.</>}
        steps={[
          <><strong>Tap Fn</strong> and speak your raw thought quickly and naturally</>,
          <><strong>Tap Fn again</strong> — you have a short window to trigger the next step</>,
          <><strong>Tap Control</strong> immediately and speak your instruction</>,
          <><strong>Tap Control again</strong> — AI takes your dictation as input and applies your instruction</>,
        ]}
        example="i need to tell sarah we cant ship friday... → make this a polite professional Slack message"
        tags={['Draft + polish in one flow', 'Brain dump → clean output', 'Fastest writing mode']}
      />
    </div>
  )
}

/* ─── Sub-workflow card ─── */

function SubWorkflow({ icon, title, description, example, result }: {
  icon: string
  title: string
  description: string
  example: string
  result: string
}) {
  return (
    <div className="bg-cream rounded-xl p-3.5 border border-border hover:border-border-md transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[12px] font-bold text-ink">{title}</span>
      </div>
      <p className="text-[11px] text-ink-60 leading-relaxed mb-2">{description}</p>
      <div className="bg-surface-2 rounded-lg p-2.5 border border-border text-[11px] mb-1.5">
        <span className="text-ink-35 font-medium">Example: </span>
        <span className="text-ink italic">{example}</span>
      </div>
      <p className="text-[10px] text-success font-medium">→ {result}</p>
    </div>
  )
}

/* ─── Mode Card ─── */

const ACCENT_COLORS: Record<string, { border: string; numberBg: string }> = {
  ink: { border: 'border-l-ink', numberBg: 'bg-ink text-white' },
  accent: { border: 'border-l-accent', numberBg: 'bg-accent text-white' },
  gold: { border: 'border-l-gold', numberBg: 'bg-gold text-white' },
  success: { border: 'border-l-success', numberBg: 'bg-success text-white' },
}

function ModeCard({
  number,
  accentColor,
  title,
  subtitle,
  trigger,
  description,
  steps,
  example,
  tags,
  accentTags,
  children,
}: {
  number: number
  accentColor: string
  title: string
  subtitle: string
  trigger: React.ReactNode
  description: React.ReactNode
  steps: React.ReactNode[]
  example: string
  tags: string[]
  accentTags?: boolean
  children?: React.ReactNode
}) {
  const colors = ACCENT_COLORS[accentColor] || ACCENT_COLORS.ink

  return (
    <div className={`bg-surface-2 border border-border ${colors.border} border-l-[3px] rounded-2xl overflow-hidden mb-3.5 shadow-md hover:shadow-lg transition-shadow`}>
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
        <div className={`w-7 h-7 rounded-full ${colors.numberBg} text-[11px] font-extrabold flex items-center justify-center shrink-0`}>
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-extrabold text-ink tracking-tight leading-none mb-1">{title}</div>
          <div className="text-[11px] text-ink-35">{subtitle}</div>
        </div>
        <div className="shrink-0 bg-cream-mid border border-border rounded-xl px-3 py-2">
          <div className="text-[9px] font-bold text-ink-35 tracking-widest uppercase mb-1.5">Trigger</div>
          {trigger}
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-5">
        <p className="text-[13px] text-ink-60 leading-relaxed mb-4 max-w-[560px]">{description}</p>

        {/* Steps */}
        <div className="border border-border rounded-xl overflow-hidden">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-cream transition-colors">
              <div className="w-5 h-5 rounded-full bg-ink text-white text-[9px] font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </div>
              <div className="text-[12px] text-ink leading-relaxed">{step}</div>
            </div>
          ))}
        </div>

        {/* Example bubble */}
        <div className="inline-flex items-center gap-2 bg-cream-mid border border-border rounded-full px-3.5 py-1.5 mt-4 text-[12px] text-ink-60 italic">
          <span className="text-ink-35 not-italic">"</span>
          {example}
          <span className="text-ink-35 not-italic">"</span>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mt-4">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                accentTags
                  ? 'bg-accent-soft text-accent border-accent-border'
                  : 'bg-cream-mid text-ink-60 border-border'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Optional children (sub-workflows) */}
        {children}
      </div>
    </div>
  )
}

/* ─── Key Badges ─── */

function KeyBadge({ children, variant }: { children: React.ReactNode; variant?: 'dark' | 'red' }) {
  const base = 'inline-flex items-center justify-center text-[11px] font-bold rounded-lg px-2.5 py-1 min-h-[28px] select-none whitespace-nowrap tracking-tight'
  if (variant === 'dark') {
    return (
      <span className={`${base} bg-gradient-to-b from-[#2E2A25] to-ink text-white/90 border border-black/50 shadow-[0_3px_0_rgba(0,0,0,0.55),0_4px_10px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.14)]`}>
        {children}
      </span>
    )
  }
  if (variant === 'red') {
    return (
      <span className={`${base} bg-gradient-to-b from-[#F04040] to-[#C82828] text-white border border-black/35 shadow-[0_3px_0_#8a1a1a,0_4px_10px_rgba(0,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.25)]`}>
        {children}
      </span>
    )
  }
  return (
    <span className={`${base} bg-gradient-to-b from-white to-[#E8E3D8] text-ink border border-border-md shadow-[0_3px_0_rgba(26,23,20,0.22),0_4px_10px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.85)]`}>
      {children}
    </span>
  )
}

function KeyBadgeHero({ children, variant }: { children: React.ReactNode; variant?: 'red' }) {
  const base = 'inline-flex items-center justify-center text-[12px] font-extrabold rounded-lg px-3 py-1.5 min-h-[36px] select-none whitespace-nowrap'
  if (variant === 'red') {
    return (
      <span className={`${base} bg-gradient-to-b from-[#F04040] to-[#C02020] text-white border border-black/40 shadow-[0_4px_0_#7a1010,0_6px_14px_rgba(200,30,30,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]`}>
        {children}
      </span>
    )
  }
  return (
    <span className={`${base} bg-gradient-to-b from-white/[0.14] to-white/[0.06] text-white/90 border border-white/16 shadow-[0_4px_0_rgba(0,0,0,0.45),0_6px_14px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.18)]`}>
      {children}
    </span>
  )
}
