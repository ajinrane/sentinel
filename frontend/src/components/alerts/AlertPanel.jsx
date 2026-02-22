import { useState, useEffect, useRef } from 'react'
import {
  AlertTriangle,
  TrendingUp,
  FileText,
  X,
  Loader2,
  Volume2,
  Triangle,
  Circle,
} from 'lucide-react'
import { t } from '../../i18n'
import { useAccessibility } from '../../contexts/AccessibilityContext'
import { useTTS } from '../accessibility/TextToSpeech'
import { simplifyAlertCard, simplifyAnomalyScore } from '../accessibility/SimpleViewTransforms'
import { theme, alpha } from '../../design'
import { API_BASE } from '../../config'

const API = API_BASE

function SeverityBadge({ anomalyScore, simpleView }) {
  const isCritical = anomalyScore > 100
  const sev = isCritical ? theme.severity.critical : theme.severity.warning

  return (
    <span
      className="flex items-center gap-1"
      style={{
        backgroundColor: sev.bg,
        color: sev.text,
        fontSize: '11px',
        fontWeight: 600,
        padding: '3px 10px',
        borderRadius: '980px',
        textTransform: 'uppercase',
      }}
    >
      {isCritical ? (
        <Triangle className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
      ) : (
        <Circle className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
      )}
      {simpleView ? simplifyAnomalyScore(anomalyScore).split(' — ')[0] : (isCritical ? 'Critical' : 'Warning')}
    </span>
  )
}

function ThreatBadge({ level }) {
  const levelMap = {
    CRITICAL: theme.severity.critical,
    HIGH: theme.severity.alert,
    MODERATE: theme.severity.moderate,
    LOW: theme.severity.low,
  }
  const sev = levelMap[level] || levelMap.MODERATE
  return (
    <span
      style={{
        backgroundColor: sev.bg,
        color: sev.text,
        fontSize: '12px',
        fontWeight: 600,
        padding: '3px 10px',
        borderRadius: '980px',
        textTransform: 'uppercase',
      }}
    >
      {level}
    </span>
  )
}

function SitRepModal({ sitrep, onClose }) {
  if (!sitrep) return null

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center view-fade-enter"
      style={{ backgroundColor: alpha(theme.colors.bg, 0.6), backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-[600px] max-h-[85vh] flex flex-col frosted-glass"
        style={{
          backgroundColor: 'rgba(28, 28, 30, 0.72)',
          borderRadius: theme.radius.lg,
          boxShadow: theme.shadow.elevated,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Situation Report: ${sitrep.title}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5" style={{ color: theme.colors.accentGreen }} aria-hidden="true" />
            <div>
              <h2 style={{ color: theme.colors.text, fontSize: '17px', fontWeight: 600 }}>{sitrep.title}</h2>
              <p style={{ color: theme.colors.textTertiary, fontSize: '13px', marginTop: '2px' }}>{sitrep.generated_at}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThreatBadge level={sitrep.threat_level} />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg btn-icon"
              style={{ color: theme.colors.textSecondary }}
              aria-label="Close situation report"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Summary */}
          <div>
            <h3
              style={{
                color: theme.colors.textSecondary,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '8px',
              }}
            >
              Summary
            </h3>
            <p style={{ color: theme.colors.text, fontSize: '14px', lineHeight: 1.47 }}>{sitrep.summary}</p>
          </div>

          {/* Case Summary */}
          {sitrep.case_summary && (
            <div>
              <h3
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                }}
              >
                Case Summary
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3" style={{ backgroundColor: alpha(theme.colors.surfaceHover, 0.5), borderRadius: theme.radius.sm }}>
                  <span style={{ color: theme.colors.textTertiary, fontSize: '13px' }}>Total cases:</span>{' '}
                  <span className="font-bold" style={{ color: theme.colors.text, fontSize: '14px' }}>{sitrep.case_summary.total_cases}</span>
                </div>
                <div className="p-3" style={{ backgroundColor: alpha(theme.colors.surfaceHover, 0.5), borderRadius: theme.radius.sm }}>
                  <span style={{ color: theme.colors.textTertiary, fontSize: '13px' }}>Trend:</span>{' '}
                  <span className="font-bold" style={{ color: theme.colors.text, fontSize: '14px' }}>{sitrep.case_summary.trend}</span>
                </div>
              </div>
              {sitrep.case_summary.severity_breakdown && (
                <p style={{ color: theme.colors.textSecondary, fontSize: '13px', lineHeight: 1.47, marginTop: '8px' }}>{sitrep.case_summary.severity_breakdown}</p>
              )}
              {sitrep.case_summary.date_range && (
                <p style={{ color: theme.colors.textTertiary, fontSize: '13px', marginTop: '4px' }}>{sitrep.case_summary.date_range}</p>
              )}
            </div>
          )}

          {/* Disease Assessment */}
          {sitrep.disease_assessment && (
            <div>
              <h3
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                }}
              >
                Disease Assessment
              </h3>
              <div className="space-y-1.5" style={{ fontSize: '14px', lineHeight: 1.47 }}>
                <p>
                  <span style={{ color: theme.colors.textTertiary }}>Probable disease:</span>{' '}
                  <span className="font-semibold uppercase" style={{ color: theme.colors.text }}>{sitrep.disease_assessment.probable_disease}</span>
                  {sitrep.disease_assessment.confidence && (
                    <span style={{ color: theme.colors.textSecondary }}> ({sitrep.disease_assessment.confidence})</span>
                  )}
                </p>
                {sitrep.disease_assessment.transmission_route && (
                  <p><span style={{ color: theme.colors.textTertiary }}>Transmission:</span> <span style={{ color: theme.colors.text }}>{sitrep.disease_assessment.transmission_route}</span></p>
                )}
                {sitrep.disease_assessment.incubation_period && (
                  <p><span style={{ color: theme.colors.textTertiary }}>Incubation:</span> <span style={{ color: theme.colors.text }}>{sitrep.disease_assessment.incubation_period}</span></p>
                )}
                {sitrep.disease_assessment.key_symptoms?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {sitrep.disease_assessment.key_symptoms.map((s) => (
                      <span
                        key={s}
                        style={{
                          backgroundColor: theme.colors.surfaceHover,
                          color: theme.colors.textSecondary,
                          borderRadius: '980px',
                          padding: '3px 10px',
                          fontSize: '12px',
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recommended Interventions */}
          {sitrep.recommended_interventions?.length > 0 && (
            <div>
              <h3
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                }}
              >
                Recommended Interventions
              </h3>
              <ul className="space-y-1.5">
                {sitrep.recommended_interventions.map((item, i) => (
                  <li key={i} className="flex gap-2" style={{ color: theme.colors.text, fontSize: '14px', lineHeight: 1.47 }}>
                    <span className="shrink-0 mt-0.5" style={{ color: theme.colors.accentGreen }}>&#x2022;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Resource Needs */}
          {sitrep.resource_needs?.length > 0 && (
            <div>
              <h3
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                }}
              >
                Resource Needs
              </h3>
              <ul className="space-y-1.5">
                {sitrep.resource_needs.map((item, i) => (
                  <li key={i} className="flex gap-2" style={{ color: theme.colors.text, fontSize: '14px', lineHeight: 1.47 }}>
                    <span className="shrink-0 mt-0.5" style={{ color: theme.colors.accentOrange }}>&#x2022;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CHW Alert */}
          {sitrep.chw_alert && (
            <div
              className="p-4"
              style={{
                backgroundColor: theme.severity.warning.bg,
                borderRadius: theme.radius.md,
              }}
            >
              <h3
                style={{
                  color: theme.severity.warning.text,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                }}
              >
                CHW Alert Message
              </h3>
              <p style={{ color: theme.colors.accentOrange, fontSize: '14px', lineHeight: 1.47 }}>{sitrep.chw_alert}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AlertPanel({ clusters, language = 'en' }) {
  const [sitrep, setSitrep] = useState(null)
  const [loadingId, setLoadingId] = useState(null)
  const { settings } = useAccessibility()
  const { speak, enabled: ttsEnabled } = useTTS()
  const prevCriticalRef = useRef(new Set())

  const activeClusters = clusters.filter((c) => c.status === 'active')

  // Auto-read critical alerts via TTS
  useEffect(() => {
    if (!settings.ttsAutoRead) return
    const prevIds = prevCriticalRef.current
    activeClusters.forEach((cluster) => {
      if (cluster.anomaly_score > 100 && !prevIds.has(cluster.id)) {
        const disease = cluster.probable_disease || 'Unknown illness'
        speak(`Critical alert: ${disease}, ${cluster.case_count} cases detected.`)
      }
    })
    prevCriticalRef.current = new Set(
      activeClusters.filter((c) => c.anomaly_score > 100).map((c) => c.id)
    )
  }, [activeClusters, settings.ttsAutoRead, speak])

  const handleReadAlerts = () => {
    const text = activeClusters
      .map((c) => `${c.probable_disease || 'Unknown'}: ${c.case_count} cases, anomaly score ${c.anomaly_score}`)
      .join('. ')
    speak(text || 'No active alerts.')
  }

  const handleGenerateSitrep = async (clusterId) => {
    const id = clusterId || 1
    setLoadingId(id)
    setSitrep(null)
    try {
      // Try POST first
      let res = await fetch(`${API}/generate-sitrep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_id: id }),
      })
      // If POST fails, try GET
      if (!res.ok && (res.status === 404 || res.status === 405)) {
        res = await fetch(`${API}/sitrep/${id}`)
      }
      if (res.ok) {
        const data = await res.json()
        if (!data.error) {
          setSitrep(data)
        } else {
          console.error('[SITREP] Backend error:', data.error)
        }
      } else {
        console.error('[SITREP] Failed:', res.status)
      }
    } catch (err) {
      console.error('[SITREP] Error:', err)
    } finally {
      setLoadingId(null)
    }
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
        <AlertTriangle className="w-3.5 h-3.5" style={{ color: theme.colors.accentOrange }} aria-hidden="true" />
        <span
          style={{
            color: theme.colors.textSecondary,
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {t(language, 'activeAlerts')}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {ttsEnabled && (
            <button
              onClick={handleReadAlerts}
              aria-label="Read active alerts aloud"
              className="p-1 rounded btn-icon"
              style={{ color: theme.colors.textTertiary }}
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          )}
          {activeClusters.length > 0 && (
            <span
              style={{
                backgroundColor: theme.severity.critical.bg,
                color: theme.severity.critical.text,
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '980px',
              }}
            >
              {activeClusters.length}
            </span>
          )}
        </div>
      </div>

      {/* Alert cards */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3"
        aria-live="assertive"
        aria-label="Active disease alerts"
      >
        {activeClusters.length === 0 && (
          <div className="text-center mt-6" style={{ color: theme.colors.textTertiary, fontSize: '14px' }}>
            {t(language, 'noActiveClusters')}
          </div>
        )}
        {activeClusters.map((cluster) => {
          const symptoms = Array.isArray(cluster.dominant_symptoms)
            ? cluster.dominant_symptoms
            : []
          const isCritical = cluster.anomaly_score > 100
          const simpleText = settings.simpleView ? simplifyAlertCard(cluster) : null

          return (
            <div
              key={cluster.id}
              role={isCritical ? 'alert' : undefined}
              aria-label={`${cluster.probable_disease || 'Unknown'} alert: ${cluster.case_count} cases, anomaly score ${cluster.anomaly_score}`}
              className={`alert-card-hover severity-fade space-y-3 ${isCritical ? 'event-critical' : ''}`}
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                borderLeft: `3px solid ${isCritical ? theme.severity.critical.text : theme.severity.warning.text}`,
                padding: '20px',
              }}
            >
              <div className="flex items-center justify-between">
                <h3 style={{ color: theme.colors.text, fontSize: '17px', fontWeight: 600, textTransform: 'uppercase' }}>
                  {cluster.probable_disease || 'Unknown'}
                </h3>
                <SeverityBadge anomalyScore={cluster.anomaly_score} simpleView={settings.simpleView} />
              </div>

              {settings.simpleView ? (
                <p style={{ color: theme.colors.textSecondary, fontSize: '14px', lineHeight: 1.47 }}>
                  {simpleText}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div style={{ color: theme.colors.textTertiary, fontSize: '13px' }}>Cases</div>
                    <div className="font-bold" style={{ color: theme.colors.text, fontSize: '20px' }}>{cluster.case_count}</div>
                  </div>
                  <div>
                    <div style={{ color: theme.colors.textTertiary, fontSize: '13px' }}>Anomaly</div>
                    <div className="font-bold flex items-center gap-1" style={{ color: theme.colors.accentOrange, fontSize: '20px' }}>
                      <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                      {cluster.anomaly_score}x
                    </div>
                  </div>
                  <div>
                    <div style={{ color: theme.colors.textTertiary, fontSize: '13px' }}>Confidence</div>
                    <div className="font-bold" style={{ color: theme.colors.text, fontSize: '20px' }}>
                      {(cluster.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              )}

              {!settings.simpleView && symptoms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {symptoms.slice(0, 4).map((s) => (
                    <span
                      key={s}
                      style={{
                        backgroundColor: theme.colors.surfaceHover,
                        color: theme.colors.textSecondary,
                        borderRadius: '980px',
                        padding: '3px 10px',
                        fontSize: '12px',
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                {!settings.simpleView && (
                  <div style={{ color: theme.colors.textTertiary, fontSize: '13px' }}>
                    Radius: {cluster.radius_km} km
                  </div>
                )}
                <button
                  onClick={() => handleGenerateSitrep(cluster.id)}
                  disabled={loadingId === cluster.id}
                  aria-label={`Generate situation report for ${cluster.probable_disease || 'unknown disease'}`}
                  className="btn-pill flex items-center gap-1.5 ml-auto"
                  style={{
                    backgroundColor: alpha(theme.colors.accentGreen, 0.15),
                    color: theme.colors.accentGreen,
                    padding: '6px 14px',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}
                >
                  {loadingId === cluster.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {t(language, 'generateSitrep')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* SitRep Modal */}
      <SitRepModal sitrep={sitrep} onClose={() => setSitrep(null)} />
    </div>
  )
}
