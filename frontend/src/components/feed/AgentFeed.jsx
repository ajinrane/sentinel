import { useEffect, useRef } from 'react'
import {
  Activity,
  ClipboardList,
  BarChart3,
  Search,
  FileText,
  Globe,
  Volume2,
} from 'lucide-react'
import { t } from '../../i18n'
import { useAccessibility } from '../../contexts/AccessibilityContext'
import { useTTS } from '../accessibility/TextToSpeech'
import { simplifyAgentName, simplifyEventMessage } from '../accessibility/SimpleViewTransforms'
import { theme, alpha } from '../../design'

const AGENT_ICONS = {
  intake: ClipboardList,
  analyst: BarChart3,
  research: Search,
  response: FileText,
  accessibility: Globe,
}

function formatTime(ts) {
  if (!ts) return '--:--:--'
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return '--:--:--'
  }
}

function EventCard({ event, simpleView }) {
  const agentDef = theme.agents[event.agent] || theme.agents.intake
  const agentColor = agentDef.color
  const Icon = AGENT_ICONS[event.agent] || ClipboardList
  const severity = theme.severity[event.severity]
  const isHigh = event.severity === 'alert' || event.severity === 'critical'
  const isWarn = event.severity === 'warning'

  const displayLabel = simpleView ? simplifyAgentName(event.agent) : agentDef.label
  const displayMessage = simpleView ? simplifyEventMessage(event.message) : event.message

  return (
    <div
      role={isHigh ? 'alert' : undefined}
      aria-label={`${displayLabel}: ${displayMessage}`}
      className={`
        event-card card-lift
        ${isHigh ? 'event-critical' : ''}
        ${isWarn ? 'event-warning' : ''}
      `}
      style={{
        borderLeft: `3px solid ${agentColor}`,
        borderRadius: theme.radius.md,
        padding: '16px',
        backgroundColor: alpha(theme.colors.surface, 0.5),
      }}
    >
      <div className="flex items-center gap-3 mb-2">
        {/* 24x24 agent icon circle */}
        <div
          className="shrink-0 flex items-center justify-center"
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: alpha(agentColor, 0.15),
          }}
        >
          <Icon className="w-3 h-3" style={{ color: agentColor }} aria-hidden="true" />
        </div>
        <span
          style={{
            color: agentColor,
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {displayLabel}
        </span>
        {severity && (
          <span
            style={{
              backgroundColor: severity.bg,
              color: severity.text,
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '980px',
              textTransform: 'uppercase',
            }}
          >
            {event.severity.toUpperCase()}
          </span>
        )}
        <span
          className="ml-auto"
          style={{
            color: theme.colors.textTertiary,
            fontSize: '12px',
            fontFamily: theme.font.mono.family,
          }}
        >
          {formatTime(event.timestamp)}
        </span>
      </div>
      <p
        style={{
          color: theme.colors.text,
          fontSize: '15px',
          fontWeight: 400,
          lineHeight: 1.47,
          paddingLeft: '36px',
        }}
      >
        {displayMessage}
      </p>
    </div>
  )
}

export default function AgentFeed({ events, language = 'en', onClear }) {
  const scrollRef = useRef(null)
  const { settings } = useAccessibility()
  const { speak, enabled: ttsEnabled } = useTTS()

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [events])

  const handleReadAll = () => {
    const last5 = events.slice(-5)
    const text = last5
      .map((e) => `${e.agent}: ${e.message}`)
      .join('. ')
    speak(text)
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: theme.colors.bg }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 shrink-0"
        style={{
          backgroundColor: alpha(theme.colors.surface, 0.8),
        }}
      >
        <Activity className="w-3.5 h-3.5 animate-pulse" style={{ color: theme.colors.accentGreen }} aria-hidden="true" />
        <span
          style={{
            color: theme.colors.textSecondary,
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {t(language, 'agentActivity')}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {ttsEnabled && (
            <button
              onClick={handleReadAll}
              aria-label="Read recent events aloud"
              className="p-1 rounded btn-icon"
              style={{ color: theme.colors.textTertiary }}
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          )}
          {Object.entries(theme.agents).map(([key, cfg]) => (
            <div
              key={key}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: cfg.color }}
              title={cfg.label}
              aria-hidden="true"
            />
          ))}
          <span style={{ color: theme.colors.textTertiary, fontSize: '12px', marginLeft: '4px' }}>{events.length}</span>
          {onClear && events.length > 0 && (
            <button
              onClick={onClear}
              aria-label="Clear event feed"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 11,
                color: '#86868B',
                cursor: 'pointer',
                marginLeft: 4,
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Feed */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Agent event feed"
        className="flex-1 overflow-y-auto p-3 space-y-2"
      >
        {events.length === 0 && (
          <div className="text-center mt-8 space-y-2" style={{ color: theme.colors.textTertiary, fontSize: '14px' }}>
            <Activity className="w-6 h-6 mx-auto animate-pulse" style={{ color: theme.colors.surfaceActive }} aria-hidden="true" />
            <p>{t(language, 'waitingForActivity')}</p>
          </div>
        )}
        {events.map((event, i) => (
          <EventCard
            key={event._uid || `${event.id}-${i}`}
            event={event}
            simpleView={settings.simpleView}
          />
        ))}
      </div>
    </div>
  )
}
