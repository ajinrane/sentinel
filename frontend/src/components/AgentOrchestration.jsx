import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Play, Activity } from 'lucide-react'
import { theme, alpha } from '../design'
import { API_BASE } from '../config'

// Pentagon layout coordinates (SVG viewBox 700x500)
const NODES = [
  { id: 'intake',        sub: 'NLP Extraction',    cx: 140, cy: 160 },
  { id: 'analyst',       sub: 'Pattern Detection',  cx: 350, cy: 75  },
  { id: 'research',      sub: 'Investigation',      cx: 560, cy: 160 },
  { id: 'response',      sub: 'SitRep & Alerts',    cx: 490, cy: 380 },
  { id: 'accessibility', sub: 'Adaptive Delivery',  cx: 210, cy: 380 },
]

const EDGES = [
  { from: 'intake',        to: 'analyst',       id: 'intake>analyst' },
  { from: 'analyst',       to: 'research',      id: 'analyst>research' },
  { from: 'analyst',       to: 'response',      id: 'analyst>response' },
  { from: 'research',      to: 'response',      id: 'research>response' },
  { from: 'research',      to: 'intake',        id: 'research>intake' },
  { from: 'response',      to: 'accessibility', id: 'response>accessibility' },
  { from: 'accessibility', to: 'intake',        id: 'accessibility>intake' },
]

const nodeMap = Object.fromEntries(NODES.map((n) => [n.id, n]))
const R = 36

// Demo sequence — each step highlights an agent + connections + adds a log entry
const STEPS = [
  {
    agent: 'intake', ms: 2200,
    conns: [],
    msg: 'Processing voice input from CHW Fatima, Mirpur-12...',
    detail: 'NL extraction: 6 patients, severe watery diarrhea, vomiting, 3 children under 5',
  },
  {
    agent: 'intake', ms: 1800,
    conns: ['intake>analyst'],
    msg: 'Encounter structured: GI symptoms, severity HIGH. Handing off to Analyst.',
    detail: 'Geocoded to Bhashantek canal area. Onset: 2-3 days ago.',
  },
  {
    agent: 'analyst', ms: 2000,
    conns: ['intake>analyst'],
    msg: 'Running DBSCAN clustering on 81 encounters...',
    detail: 'eps=0.02 deg, min_samples=3, temporal_window=5d',
  },
  {
    agent: 'analyst', ms: 2200,
    conns: ['analyst>research', 'analyst>response'],
    msg: 'CLUSTER DETECTED: 47 GI cases within 2km over 5 days.',
    detail: 'Anomaly score: 651.69 (baseline 2.3/day exceeded by 283x). Cholera signature: 87%.',
  },
  {
    agent: 'research', ms: 2000,
    conns: ['analyst>research'],
    msg: 'Investigating cluster epidemiological profile...',
    detail: 'Querying API for differential diagnosis and environmental analysis...',
  },
  {
    agent: 'research', ms: 2200,
    conns: ['research>response'],
    msg: 'Differential: V. cholerae O1 (87%), ETEC (8%), Shigella (3%).',
    detail: 'Bhashantek canal: probable contamination source. Monsoon flooding increases risk.',
  },
  {
    agent: 'research', ms: 2500,
    conns: ['research>intake'],
    msg: 'CLOSED LOOP: Generating targeted follow-up questions for CHWs.',
    detail: 'Ask about water source. Check canal water usage. Note rice-water stool appearance.',
  },
  {
    agent: 'response', ms: 2000,
    conns: ['research>response'],
    msg: 'Generating SitRep SITREP-2026-DHK-004...',
    detail: 'Compiling: event summary, epi profile, interventions, resource allocation.',
  },
  {
    agent: 'response', ms: 2000,
    conns: ['response>accessibility'],
    msg: 'SitRep complete. CHW alerts deployed to Mirpur-12 district.',
    detail: 'ORS distribution + water testing sectors 4-7 + vaccination mobilization.',
  },
  {
    agent: 'accessibility', ms: 2200,
    conns: ['response>accessibility', 'accessibility>intake'],
    msg: 'Adapting outputs for CHW literacy and device profiles...',
    detail: 'Fatima: Bengali, moderate literacy -> simplified text + voice. Rahim: voice-only.',
  },
  {
    agent: 'accessibility', ms: 1800,
    conns: ['accessibility>intake'],
    msg: 'All outputs adapted. Voice briefings generated in Bengali and Hindi.',
    detail: 'Interaction pacing adjusted. Follow-up questions simplified for field use.',
  },
]

function getNodeColor(id) {
  return theme.agents[id]?.color || theme.colors.textTertiary
}

function getNodeLabel(id) {
  return theme.agents[id]?.label || id.toUpperCase()
}

function formatTime(ts) {
  if (!ts) return '--:--'
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return '--:--'
  }
}

export default function AgentOrchestration({ events, onBack }) {
  // Event-based node highlighting (passive mode — WebSocket events)
  const [wsActiveAgents, setWsActiveAgents] = useState({})
  const wsTimersRef = useRef({})

  // Demo state (active mode — STEPS sequence)
  const [running, setRunning] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [activeAgent, setActiveAgent] = useState(null)
  const [activeConns, setActiveConns] = useState([])
  const [log, setLog] = useState([])
  const timerRef = useRef(null)
  const feedRef = useRef(null)

  // Highlight agent nodes based on incoming WebSocket events (passive mode)
  useEffect(() => {
    if (running || events.length === 0) return
    const latest = events[events.length - 1]
    const agentId = latest.agent
    if (!agentId || !nodeMap[agentId]) return

    setWsActiveAgents((prev) => ({ ...prev, [agentId]: true }))

    if (wsTimersRef.current[agentId]) clearTimeout(wsTimersRef.current[agentId])
    wsTimersRef.current[agentId] = setTimeout(() => {
      setWsActiveAgents((prev) => ({ ...prev, [agentId]: false }))
    }, 4000)
  }, [events, running])

  // Cleanup WS timers on unmount
  useEffect(() => {
    const timers = wsTimersRef.current
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t))
    }
  }, [])

  // Cleanup demo timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({
        top: feedRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [log, events])

  const doStep = useCallback((i) => {
    if (i >= STEPS.length) {
      // Pipeline complete
      setRunning(false)
      setActiveAgent(null)
      setActiveConns([])
      setCurrentStep(-1)
      setLog((prev) => [
        ...prev,
        {
          agent: 'system',
          msg: 'Pipeline complete. All agents processed.',
          detail: '',
          time: new Date().toLocaleTimeString('en-US', { hour12: false }),
          _uid: `done-${Date.now()}`,
        },
      ])
      return
    }

    const step = STEPS[i]
    setCurrentStep(i)
    setActiveAgent(step.agent)
    setActiveConns(step.conns || [])
    setLog((prev) => [
      ...prev,
      {
        agent: step.agent,
        msg: step.msg,
        detail: step.detail,
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        _uid: `step-${i}-${Date.now()}`,
      },
    ])

    // Schedule next step
    timerRef.current = setTimeout(() => doStep(i + 1), step.ms)
  }, [])

  const handleStart = useCallback(() => {
    if (running) return

    // Clear previous state
    setRunning(true)
    setLog([])
    setActiveAgent(null)
    setActiveConns([])
    setCurrentStep(-1)

    // Also fire the real backend pipeline so events flow to the main dashboard
    fetch(`${API_BASE}/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      // Fallback — backend might not have /demo
      fetch(`${API_BASE}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'This is CHW Fatima in Mirpur-12. I saw 6 patients today, all with severe watery diarrhea and vomiting. Three are children under 5.',
          chw_id: 'CHW-042-FATIMA',
          lat: 23.8042,
          lng: 90.3687,
        }),
      }).catch(() => {})
    })

    // Start the visual demo sequence
    doStep(0)
  }, [running, doStep])

  // Determine which nodes/edges are active (demo overrides passive)
  const isNodeActive = (id) => {
    if (running) return activeAgent === id
    return wsActiveAgents[id]
  }

  const isEdgeActive = (edgeId) => {
    if (running) return activeConns.includes(edgeId)
    // In passive mode, highlight edge if either endpoint is active
    const edge = EDGES.find((e) => e.id === edgeId)
    if (!edge) return false
    return wsActiveAgents[edge.from] || wsActiveAgents[edge.to]
  }

  // Show local log during demo, parent events when idle
  const feedItems = running || log.length > 0 ? log : events.slice(-40)
  const isLogMode = running || log.length > 0

  return (
    <div style={{ display: 'flex', height: '100%', background: theme.colors.bg, color: theme.colors.text }} role="region" aria-label="Agent orchestration pipeline">
      {/* Left: SVG Pipeline Diagram */}
      <div style={{ flex: '1 1 65%', display: 'flex', flexDirection: 'column' }}>
        {/* Header bar */}
        <div
          className="frosted-glass"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px',
            background: theme.glass.background,
          }}
        >
          <button
            onClick={onBack}
            aria-label="Back to dashboard"
            className="btn-pill"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: theme.colors.surfaceHover,
              color: theme.colors.textSecondary,
            }}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Dashboard
          </button>
          <span
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 11,
              color: theme.colors.textTertiary,
              textTransform: 'uppercase',
              letterSpacing: 3,
              fontWeight: 700,
            }}
          >
            Agent Orchestration
          </span>
          <button
            onClick={handleStart}
            disabled={running}
            aria-label={running ? 'Demo running' : 'Run demo simulation'}
            className="btn-pill"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              background: running ? theme.colors.surfaceHover : alpha(theme.colors.accentGreen, 0.15),
              color: running ? theme.colors.textTertiary : theme.colors.accentGreen,
            }}
          >
            <Play size={14} aria-hidden="true" />
            {running ? `Step ${currentStep + 1}/${STEPS.length}...` : 'RUN DEMO'}
          </button>
        </div>

        {/* SVG Diagram */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <svg
            viewBox="0 0 700 500"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', maxWidth: 750, height: 'auto' }}
          >
            <defs>
              {/* Glow filter per agent */}
              {NODES.map((n) => {
                const color = getNodeColor(n.id)
                return (
                  <filter
                    key={n.id}
                    id={`glow-${n.id}`}
                    x="-80%"
                    y="-80%"
                    width="260%"
                    height="260%"
                  >
                    <feGaussianBlur stdDeviation="8" result="b" />
                    <feFlood floodColor={color} floodOpacity="0.35" />
                    <feComposite in2="b" operator="in" />
                    <feMerge>
                      <feMergeNode />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                )
              })}
              {/* Subtle grid pattern */}
              <pattern
                id="grid"
                width="30"
                height="30"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 30 0 L 0 0 0 30"
                  fill="none"
                  stroke={theme.colors.border}
                  strokeWidth="0.3"
                />
              </pattern>
            </defs>

            {/* Grid background */}
            <rect width="700" height="500" fill="url(#grid)" opacity="0.4" />

            {/* Central watermark */}
            <text
              x="350"
              y="235"
              textAnchor="middle"
              fill={theme.colors.surface}
              fontSize="38"
              fontWeight="900"
              letterSpacing="6"
              fontFamily="monospace"
            >
              SENTINEL
            </text>
            <text
              x="350"
              y="258"
              textAnchor="middle"
              fill={theme.colors.surface}
              fontSize="9"
              letterSpacing="3"
            >
              AUTONOMOUS PIPELINE
            </text>

            {/* Connection edges */}
            {EDGES.map((edge) => {
              const f = nodeMap[edge.from]
              const t = nodeMap[edge.to]
              if (!f || !t) return null
              const dx = t.cx - f.cx
              const dy = t.cy - f.cy
              const dist = Math.sqrt(dx * dx + dy * dy)
              const x1 = f.cx + (dx / dist) * (R + 6)
              const y1 = f.cy + (dy / dist) * (R + 6)
              const x2 = t.cx - (dx / dist) * (R + 6)
              const y2 = t.cy - (dy / dist) * (R + 6)
              const active = isEdgeActive(edge.id)
              const fromColor = getNodeColor(edge.from)
              const isClosedLoop = edge.id === 'research>intake' || edge.id === 'accessibility>intake'

              return (
                <g key={edge.id}>
                  {/* Base line */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={active ? theme.colors.surfaceActive : theme.colors.border}
                    strokeWidth={active ? 1.5 : 0.8}
                    strokeDasharray={isClosedLoop ? '6 4' : 'none'}
                    style={{ transition: 'all 300ms ease-out' }}
                  />
                  {/* Animated flow */}
                  {active && (
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={fromColor}
                      strokeWidth="2.5"
                      strokeDasharray="6 14"
                      opacity="0.8"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="-20"
                        dur="1.2s"
                        repeatCount="indefinite"
                      />
                    </line>
                  )}
                  {/* Flow label at midpoint */}
                  {active && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 8}
                      textAnchor="middle"
                      fill={theme.colors.textTertiary}
                      fontSize="7"
                      letterSpacing="1"
                    >
                      {edge.from === 'intake'
                        ? 'ENCOUNTERS'
                        : edge.from === 'analyst'
                          ? 'CLUSTERS'
                          : edge.from === 'research'
                            ? isClosedLoop ? 'FOLLOW-UP' : 'ASSESSMENT'
                            : edge.from === 'response'
                              ? 'ALERTS'
                              : 'ADAPTED'}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Agent nodes */}
            {NODES.map((n) => {
              const active = isNodeActive(n.id)
              const color = getNodeColor(n.id)
              const label = getNodeLabel(n.id)
              return (
                <g key={n.id}>
                  {/* Pulsing outer ring when active */}
                  {active && (
                    <circle
                      cx={n.cx}
                      cy={n.cy}
                      r={R + 14}
                      fill="none"
                      stroke={color}
                      strokeWidth="1"
                    >
                      <animate
                        attributeName="r"
                        values={`${R + 10};${R + 16};${R + 10}`}
                        dur="3s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.25;0.06;0.25"
                        dur="3s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}

                  {/* Node circle */}
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={active ? R + 2 : R}
                    fill={active ? alpha(color, 0.09) : theme.colors.surface}
                    stroke={color}
                    strokeWidth={active ? 2.5 : 1}
                    opacity={active ? 1 : 0.4}
                    filter={active ? `url(#glow-${n.id})` : undefined}
                    style={{ transition: 'all 300ms ease-out' }}
                  />

                  {/* Letter icon */}
                  <text
                    x={n.cx}
                    y={n.cy + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize="18"
                    fontWeight="bold"
                    fontFamily="monospace"
                    opacity={active ? 1 : 0.5}
                  >
                    {label.charAt(0)}
                  </text>

                  {/* Label */}
                  <text
                    x={n.cx}
                    y={n.cy + R + 16}
                    textAnchor="middle"
                    fill={active ? theme.colors.text : theme.colors.textTertiary}
                    fontSize="10"
                    fontWeight="700"
                    letterSpacing="1.5"
                    style={{ transition: 'fill 200ms' }}
                  >
                    {label}
                  </text>

                  {/* Sub-label */}
                  <text
                    x={n.cx}
                    y={n.cy + R + 28}
                    textAnchor="middle"
                    fill={theme.colors.textTertiary}
                    fontSize="8"
                  >
                    {n.sub}
                  </text>

                  {/* Active indicator dot */}
                  {active && (
                    <circle
                      cx={n.cx + R - 6}
                      cy={n.cy - R + 6}
                      r="4"
                      fill={color}
                    >
                      <animate
                        attributeName="opacity"
                        values="1;0.5;1"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* Right: Pipeline Activity Feed */}
      <div
        style={{
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          background: theme.colors.surface,
        }}
      >
        {/* Feed header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            backgroundColor: alpha(theme.colors.surface, 0.8),
          }}
        >
          <Activity size={14} color={theme.colors.accentGreen} className="animate-pulse" aria-hidden="true" />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: theme.colors.textTertiary,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
            }}
          >
            {isLogMode ? 'Demo Pipeline' : 'Pipeline Activity'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: theme.colors.surfaceActive }}>
            {feedItems.length}
          </span>
        </div>

        {/* Event list */}
        <div
          ref={feedRef}
          role="log"
          aria-live="polite"
          aria-label="Pipeline activity feed"
          style={{ flex: 1, overflowY: 'auto', padding: 8 }}
        >
          {feedItems.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                color: theme.colors.surfaceActive,
                fontSize: 12,
                marginTop: 48,
              }}
            >
              Click RUN DEMO to start the pipeline...
            </div>
          )}
          {feedItems.map((ev, i) => {
            const agentId = ev.agent
            const node = nodeMap[agentId]
            const color = node ? getNodeColor(node.id) : agentId === 'system' ? theme.colors.accentGreen : theme.colors.textTertiary
            const label = node ? getNodeLabel(node.id) : agentId === 'system' ? 'SYSTEM' : (agentId?.toUpperCase() || '?')
            const isHighSev = ev.severity === 'alert' || ev.severity === 'critical'
            const sevStyle = ev.severity ? theme.severity[ev.severity] : null
            const message = ev.msg || ev.message || ''
            const detail = ev.detail || ''
            const time = ev.time || formatTime(ev.timestamp)

            return (
              <div
                key={ev._uid || `${ev.id}-${i}`}
                className="event-card"
                style={{
                  padding: '6px 10px',
                  marginBottom: 4,
                  borderRadius: 6,
                  borderLeft: `2px solid ${color}`,
                  background: isHighSev ? alpha(theme.colors.accentRed, 0.07) : alpha(theme.colors.surface, 0.19),
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color,
                      letterSpacing: 1,
                    }}
                  >
                    {label}
                  </span>
                  {ev.severity && ev.severity !== 'info' && sevStyle && (
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        textTransform: 'uppercase',
                        background: sevStyle.bg,
                        color: sevStyle.text,
                      }}
                    >
                      {ev.severity}
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 9,
                      color: theme.colors.surfaceActive,
                      fontFamily: 'monospace',
                    }}
                  >
                    {time}
                  </span>
                </div>
                <div
                  style={{ fontSize: 11, color: theme.colors.textSecondary, lineHeight: 1.4 }}
                >
                  {message}
                </div>
                {detail && (
                  <div
                    style={{ fontSize: 10, color: theme.colors.textTertiary, lineHeight: 1.3, marginTop: 2 }}
                  >
                    {detail}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
