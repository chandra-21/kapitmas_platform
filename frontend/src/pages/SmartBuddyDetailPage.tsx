import { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowLeft, MapPin, Wind, Lightbulb, Calendar, Radio,
  Plus, Pencil, Trash2, X, Zap, Clock, AlertCircle, Activity,
  Loader2, MoreHorizontal, ArrowUpCircle, Edit2,
} from 'lucide-react'
import {
  getSmartBuddyDevice,
  sendACCommand, sendLampCommand,
  updateSmartBuddySchedule, triggerSmartBuddyIRLearn,
  updateSmartBuddyDevice, deleteSmartBuddyDevice,
  getLocations, createLocation,
} from '@/lib/api'
import type { ACMode, ACFan, LampMode, ScheduleEntry, SmartBuddyDevice } from '@/lib/api'
import { usePermissions } from '@/hooks/usePermissions'
import { useSSE } from '@/lib/useSSE'
import type { SSEEvent } from '@/lib/useSSE'

// ── Helpers ──────────────────────────────────────────────────────────────────

const GOLD = '#C9A84C'

function fmt(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtTime(ts: string | null) {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtHM(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const BRAND_LABEL: Record<string, string> = {
  daikin: 'Daikin', lg: 'LG', panasonic: 'Panasonic',
  samsung: 'Samsung', gree: 'Gree', midea: 'Midea', learned: 'IR Learned',
}

// ── Design components ─────────────────────────────────────────────────────────

function SectionCard({ title, icon, children, right }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode
}) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ borderColor: 'var(--c-border)', background: 'rgba(var(--c-border-rgb),0.20)' }}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: GOLD }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b last:border-0"
      style={{ borderColor: 'var(--c-border)88' }}>
      <span className="text-sm" style={{ color: 'var(--c-muted)' }}>{label}</span>
      <span className={`text-sm text-right max-w-[60%] truncate ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: 'var(--c-primary)' }}>
        {value}
      </span>
    </div>
  )
}

// ── AC Control ────────────────────────────────────────────────────────────────

const AC_MODES: { value: ACMode; label: string; icon: string }[] = [
  { value: 'cool', label: 'Cool', icon: '❄️' },
  { value: 'heat', label: 'Heat', icon: '🔥' },
  { value: 'dry',  label: 'Dry',  icon: '💧' },
  { value: 'fan',  label: 'Fan',  icon: '🌀' },
  { value: 'auto', label: 'Auto', icon: '🔄' },
]

const AC_FANS: { value: ACFan; label: string }[] = [
  { value: 'auto',   label: 'Auto'   },
  { value: 'quiet',  label: 'Quiet'  },
  { value: 'low',    label: 'Low'    },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High'   },
]

function ACControlSection({ sb, canControl }: { sb: SmartBuddyDevice; canControl: boolean }) {
  const qc = useQueryClient()
  const init = sb.ac_state
  const [power,   setPower]  = useState(init.power)
  const [mode,    setMode]   = useState<ACMode>(init.mode)
  const [temp,    setTemp]   = useState(init.temp)
  const [fan,     setFan]    = useState<ACFan>(init.fan)
  const [swingV,  setSwingV] = useState(init.swing_v)

  const mut = useMutation({
    mutationFn: (cmd: Parameters<typeof sendACCommand>[1]) => sendACCommand(sb.id, cmd),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smartbuddy-device', sb.id] }),
    onError: (e: Error) => toast.error(`AC: ${e.message}`),
  })

  function send(overrides: Partial<{ power: boolean; mode: ACMode; temp: number; fan: ACFan; swing_v: boolean }>) {
    if (!canControl) return
    const next = { power, mode, temp, fan, swing_v: swingV, ...overrides }
    if (overrides.power   !== undefined) setPower(overrides.power)
    if (overrides.mode    !== undefined) setMode(overrides.mode)
    if (overrides.temp    !== undefined) setTemp(overrides.temp)
    if (overrides.fan     !== undefined) setFan(overrides.fan)
    if (overrides.swing_v !== undefined) setSwingV(overrides.swing_v)
    mut.mutate(next)
  }

  const isPending = mut.isPending

  return (
    <SectionCard
      title="AC Control"
      icon={<Wind size={12} style={{ color: GOLD }} />}
      right={isPending ? <Loader2 size={12} className="animate-spin" style={{ color: GOLD }} /> : undefined}
    >
      <div className="p-4 flex flex-col gap-5">

        {/* Power */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Power</span>
          <button
            disabled={!canControl}
            onClick={() => send({ power: !power })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm font-bold transition-all"
            style={{
              background: power ? 'rgba(66,165,245,0.15)' : 'rgba(var(--c-border-rgb),0.50)',
              border: `1px solid ${power ? 'rgba(66,165,245,0.50)' : 'var(--c-border)'}`,
              color: power ? '#42A5F5' : 'var(--c-faint)',
              cursor: canControl ? 'pointer' : 'not-allowed',
              opacity: canControl ? 1 : 0.5,
            }}
          >
            <div className="w-8 h-4 rounded-full flex items-center px-0.5 transition-colors"
              style={{ background: power ? '#42A5F5' : 'var(--c-border)' }}>
              <div className="w-3 h-3 rounded-full bg-white transition-transform"
                style={{ transform: power ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 0.15s' }} />
            </div>
            {power ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Mode */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest mb-2.5" style={{ color: 'var(--c-muted)' }}>Mode</p>
          <div className="flex flex-wrap gap-1.5">
            {AC_MODES.map(o => (
              <button key={o.value}
                disabled={!canControl || !power}
                onClick={() => send({ mode: o.value })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: mode === o.value ? 'rgba(66,165,245,0.15)' : 'transparent',
                  border: `1px solid ${mode === o.value ? 'rgba(66,165,245,0.50)' : 'var(--c-border)'}`,
                  color: mode === o.value ? '#42A5F5' : 'var(--c-muted)',
                  opacity: (!canControl || !power) ? 0.4 : 1,
                  cursor: (!canControl || !power) ? 'not-allowed' : 'pointer',
                }}>
                <span className="mr-1">{o.icon}</span>{o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Temperature */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Temperature</p>
            <p className="font-mono text-3xl font-bold tabular-nums" style={{ color: '#42A5F5' }}>{temp}°C</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs" style={{ color: 'var(--c-faint)' }}>16</span>
            <input type="range" min={16} max={30} value={temp}
              disabled={!canControl || !power}
              onChange={e => setTemp(Number(e.target.value))}
              onMouseUp={e => send({ temp: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={e => send({ temp: Number((e.target as HTMLInputElement).value) })}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #42A5F5 ${((temp - 16) / (30 - 16)) * 100}%, var(--c-border) 0%)`,
                opacity: (!canControl || !power) ? 0.4 : 1,
              }}
            />
            <span className="font-mono text-xs" style={{ color: 'var(--c-faint)' }}>30</span>
          </div>
        </div>

        {/* Fan */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest mb-2.5" style={{ color: 'var(--c-muted)' }}>Fan Speed</p>
          <div className="flex flex-wrap gap-1.5">
            {AC_FANS.map(o => (
              <button key={o.value}
                disabled={!canControl || !power}
                onClick={() => send({ fan: o.value })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: fan === o.value ? 'rgba(66,165,245,0.15)' : 'transparent',
                  border: `1px solid ${fan === o.value ? 'rgba(66,165,245,0.50)' : 'var(--c-border)'}`,
                  color: fan === o.value ? '#42A5F5' : 'var(--c-muted)',
                  opacity: (!canControl || !power) ? 0.4 : 1,
                  cursor: (!canControl || !power) ? 'not-allowed' : 'pointer',
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Swing */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Swing V</span>
          <button
            disabled={!canControl || !power}
            onClick={() => send({ swing_v: !swingV })}
            className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
            style={{
              background: swingV ? 'rgba(66,165,245,0.15)' : 'transparent',
              border: `1px solid ${swingV ? 'rgba(66,165,245,0.50)' : 'var(--c-border)'}`,
              color: swingV ? '#42A5F5' : 'var(--c-faint)',
              opacity: (!canControl || !power) ? 0.4 : 1,
              cursor: (!canControl || !power) ? 'not-allowed' : 'pointer',
            }}>
            {swingV ? 'ON' : 'OFF'}
          </button>
        </div>

        {init.last_cmd && (
          <p className="font-mono text-[9px] text-right" style={{ color: 'var(--c-faint)' }}>
            Last sent: {fmt(init.last_cmd)}
          </p>
        )}
      </div>
    </SectionCard>
  )
}

// ── Lamp Control ──────────────────────────────────────────────────────────────

const LAMP_MODES: { value: LampMode; label: string }[] = [
  { value: 'manual',   label: 'Manual'   },
  { value: 'auto_pir', label: 'Auto PIR' },
  { value: 'schedule', label: 'Schedule' },
]

function LampControlSection({ sb, canControl, pirMotion }: {
  sb: SmartBuddyDevice; canControl: boolean; pirMotion: boolean
}) {
  const qc = useQueryClient()
  const init = sb.lamp_state
  const [power,      setPower]      = useState(init.power)
  const [mode,       setMode]       = useState<LampMode>(init.mode)
  const [pirTimeout, setPirTimeout] = useState(init.pir_timeout)

  const mut = useMutation({
    mutationFn: (cmd: Parameters<typeof sendLampCommand>[1]) => sendLampCommand(sb.id, cmd),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smartbuddy-device', sb.id] }),
    onError: (e: Error) => toast.error(`Lamp: ${e.message}`),
  })

  function send(overrides: Partial<{ power: boolean; mode: LampMode; pir_timeout: number }>) {
    if (!canControl) return
    const next = { power, mode, pir_timeout: pirTimeout, ...overrides }
    if (overrides.power       !== undefined) setPower(overrides.power)
    if (overrides.mode        !== undefined) setMode(overrides.mode)
    if (overrides.pir_timeout !== undefined) setPirTimeout(overrides.pir_timeout)
    mut.mutate({ power: next.power, mode: next.mode, pir_timeout: next.pir_timeout })
  }

  return (
    <SectionCard
      title="Lamp Control"
      icon={<Lightbulb size={12} style={{ color: GOLD }} />}
      right={mut.isPending ? <Loader2 size={12} className="animate-spin" style={{ color: GOLD }} /> : undefined}
    >
      <div className="p-4 flex flex-col gap-5">

        {/* Power */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Power</span>
          <button
            disabled={!canControl}
            onClick={() => send({ power: !power })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm font-bold transition-all"
            style={{
              background: power ? 'rgba(255,183,77,0.15)' : 'rgba(var(--c-border-rgb),0.50)',
              border: `1px solid ${power ? 'rgba(255,183,77,0.50)' : 'var(--c-border)'}`,
              color: power ? '#FFB74D' : 'var(--c-faint)',
              cursor: canControl ? 'pointer' : 'not-allowed',
              opacity: canControl ? 1 : 0.5,
            }}
          >
            <div className="w-8 h-4 rounded-full flex items-center px-0.5 transition-colors"
              style={{ background: power ? '#FFB74D' : 'var(--c-border)' }}>
              <div className="w-3 h-3 rounded-full bg-white transition-transform"
                style={{ transform: power ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 0.15s' }} />
            </div>
            {power ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Mode */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest mb-2.5" style={{ color: 'var(--c-muted)' }}>Mode</p>
          <div className="flex flex-wrap gap-1.5">
            {LAMP_MODES.map(o => (
              <button key={o.value}
                disabled={!canControl}
                onClick={() => send({ mode: o.value })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: mode === o.value ? 'rgba(255,183,77,0.15)' : 'transparent',
                  border: `1px solid ${mode === o.value ? 'rgba(255,183,77,0.50)' : 'var(--c-border)'}`,
                  color: mode === o.value ? '#FFB74D' : 'var(--c-muted)',
                  opacity: canControl ? 1 : 0.5,
                  cursor: canControl ? 'pointer' : 'not-allowed',
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* PIR timeout */}
        {mode === 'auto_pir' && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-muted)' }}>
              Auto-off timeout
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={10} max={3600} value={pirTimeout}
                disabled={!canControl}
                onChange={e => setPirTimeout(Number(e.target.value))}
                onBlur={() => send({ pir_timeout: pirTimeout })}
                className="w-24 px-3 py-1.5 rounded-lg text-sm font-mono text-center"
                style={{
                  background: 'var(--bg-base)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-primary)',
                  opacity: canControl ? 1 : 0.5,
                }}
              />
              <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
                seconds ({Math.floor(pirTimeout / 60)}m {pirTimeout % 60}s)
              </span>
            </div>
          </div>
        )}

        {/* PIR live indicator */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
          style={{
            background: pirMotion ? 'rgba(255,183,77,0.10)' : 'var(--bg-base)',
            border: `1px solid ${pirMotion ? 'rgba(255,183,77,0.40)' : 'var(--c-border)'}`,
          }}>
          <motion.div className="w-2 h-2 rounded-full"
            animate={pirMotion ? { opacity: [1, 0.3, 1], scale: [1, 1.3, 1] } : { opacity: 1 }}
            transition={{ repeat: pirMotion ? Infinity : 0, duration: 0.8 }}
            style={{ background: pirMotion ? '#FFB74D' : 'var(--c-faint)' }}
          />
          <Activity size={12} style={{ color: pirMotion ? '#FFB74D' : 'var(--c-faint)' }} />
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: pirMotion ? '#FFB74D' : 'var(--c-muted)' }}>
            PIR Motion
          </span>
          <span className="font-mono text-[9px] ml-auto font-bold" style={{ color: pirMotion ? '#FFB74D' : 'var(--c-faint)' }}>
            {pirMotion ? 'DETECTED' : 'CLEAR'}
          </span>
        </div>

        {init.last_cmd && (
          <p className="font-mono text-[9px] text-right" style={{ color: 'var(--c-faint)' }}>
            Last sent: {fmt(init.last_cmd)}
          </p>
        )}
      </div>
    </SectionCard>
  )
}

// ── Schedule ──────────────────────────────────────────────────────────────────

const EMPTY_SCHEDULE: ScheduleEntry = {
  enabled: true, hour: 7, minute: 0,
  days: [false, true, true, true, true, true, false],
  target: 'ac', power: true, ac_temp: 25, ac_mode: 1, ac_fan: 0,
}
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const GOLD_CHIP = { background: `rgba(201,168,76,0.15)`, border: `1px solid rgba(201,168,76,0.45)`, color: GOLD }
const DIM_CHIP  = { background: 'transparent', border: '1px solid var(--c-border)', color: 'var(--c-faint)' }

function ScheduleModal({ entry, onSave, onClose }: {
  entry: ScheduleEntry | null; onSave: (e: ScheduleEntry) => void; onClose: () => void
}) {
  const [form, setForm] = useState<ScheduleEntry>(entry ?? EMPTY_SCHEDULE)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: GOLD }}>
            {entry ? 'Edit Schedule' : 'Add Schedule'}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5">
            <X size={14} style={{ color: 'var(--c-muted)' }} />
          </button>
        </div>

        {/* Target */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-faint)' }}>Target</p>
          <div className="flex gap-2">
            {[{ v: 'ac', l: '❄️ AC' }, { v: 'lamp', l: '💡 Lamp' }].map(o => (
              <button key={o.v} onClick={() => setForm(f => ({ ...f, target: o.v as 'ac' | 'lamp' }))}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                style={form.target === o.v ? GOLD_CHIP : DIM_CHIP}>
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* Action */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-faint)' }}>Action</p>
          <div className="flex gap-2">
            {[{ v: true, l: 'Turn ON' }, { v: false, l: 'Turn OFF' }].map(o => (
              <button key={String(o.v)} onClick={() => setForm(f => ({ ...f, power: o.v }))}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                style={form.power === o.v ? GOLD_CHIP : DIM_CHIP}>
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-faint)' }}>Time</p>
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={23} value={form.hour}
              onChange={e => setForm(f => ({ ...f, hour: Number(e.target.value) }))}
              className="w-16 px-2 py-2 rounded-lg text-center font-mono text-sm"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
            <span className="font-bold" style={{ color: 'var(--c-muted)' }}>:</span>
            <input type="number" min={0} max={59} value={form.minute}
              onChange={e => setForm(f => ({ ...f, minute: Number(e.target.value) }))}
              className="w-16 px-2 py-2 rounded-lg text-center font-mono text-sm"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }} />
          </div>
        </div>

        {/* Days */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-faint)' }}>Days</p>
          <div className="flex gap-1.5">
            {DAY_LABELS.map((d, i) => (
              <button key={i}
                onClick={() => { const days = [...form.days]; days[i] = !days[i]; setForm(f => ({ ...f, days })) }}
                className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
                style={form.days[i] ? GOLD_CHIP : DIM_CHIP}>
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* AC options */}
        {form.target === 'ac' && form.power && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-faint)' }}>Temperature</p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs" style={{ color: 'var(--c-faint)' }}>16</span>
              <input type="range" min={16} max={30} value={form.ac_temp ?? 25}
                onChange={e => setForm(f => ({ ...f, ac_temp: Number(e.target.value) }))}
                className="flex-1" />
              <span className="font-mono text-sm font-bold" style={{ color: GOLD }}>{form.ac_temp ?? 25}°C</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
            Cancel
          </button>
          <button
            onClick={() => { onSave(form); onClose() }}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: 'linear-gradient(135deg,#C9A84C,#E8C96A)', color: 'var(--bg-base)' }}>
            Save
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function ScheduleSection({ sb, canControl }: { sb: SmartBuddyDevice; canControl: boolean }) {
  const qc = useQueryClient()
  const [modalEntry, setModalEntry] = useState<ScheduleEntry | null | undefined>(undefined)
  const [editIndex,  setEditIndex]  = useState<number | null>(null)

  const schedules: ScheduleEntry[] = sb.schedules ?? []

  const saveMut = useMutation({
    mutationFn: (list: ScheduleEntry[]) => updateSmartBuddySchedule(sb.id, list),
    onSuccess: () => {
      toast.success('Schedule updated')
      qc.invalidateQueries({ queryKey: ['smartbuddy-device', sb.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSave(entry: ScheduleEntry) {
    const list = [...schedules]
    if (editIndex !== null) list[editIndex] = entry; else list.push(entry)
    saveMut.mutate(list)
    setEditIndex(null)
  }

  function handleDelete(i: number) { saveMut.mutate(schedules.filter((_, idx) => idx !== i)) }
  function handleToggle(i: number) {
    saveMut.mutate(schedules.map((s, idx) => idx === i ? { ...s, enabled: !s.enabled } : s))
  }

  return (
    <SectionCard
      title={`Schedule (${schedules.length})`}
      icon={<Calendar size={12} style={{ color: GOLD }} />}
      right={canControl ? (
        <button onClick={() => { setEditIndex(null); setModalEntry(null) }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono text-[10px] transition-all"
          style={GOLD_CHIP}>
          <Plus size={10} />Add
        </button>
      ) : undefined}
    >
      {schedules.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2">
          <Clock size={24} style={{ color: 'var(--c-faint)' }} />
          <p className="font-mono text-xs" style={{ color: 'var(--c-faint)' }}>No schedules</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                {['Time', 'Target', 'Action', 'Days', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[9px] uppercase tracking-widest"
                    style={{ color: 'var(--c-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s, i) => (
                <tr key={i} style={{ borderBottom: i < schedules.length - 1 ? '1px solid var(--c-border)88' : undefined, opacity: s.enabled ? 1 : 0.4 }}>
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-base" style={{ color: 'var(--c-primary)' }}>
                      {fmtHM(s.hour, s.minute)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs uppercase" style={{ color: GOLD }}>{s.target}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded"
                      style={{
                        background: s.power ? 'rgba(76,175,80,0.15)' : 'rgba(160,168,192,0.08)',
                        color: s.power ? '#4CAF50' : 'var(--c-faint)',
                      }}>
                      {s.power ? 'ON' : 'OFF'}{s.target === 'ac' && s.power && s.ac_temp ? ` · ${s.ac_temp}°C` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-0.5">
                      {DAY_LABELS.map((d, di) => (
                        <span key={di} className="w-5 h-5 rounded text-[9px] flex items-center justify-center font-mono"
                          style={s.days[di] ? GOLD_CHIP : DIM_CHIP}>{d}</span>
                      ))}
                    </div>
                  </td>
                  {canControl && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleToggle(i)} className="p-1.5 rounded hover:bg-white/5"
                          style={{ color: s.enabled ? GOLD : 'var(--c-faint)' }} title={s.enabled ? 'Disable' : 'Enable'}>
                          <Zap size={12} />
                        </button>
                        <button onClick={() => { setEditIndex(i); setModalEntry(s) }} className="p1.5 rounded hover:bg-white/5"
                          style={{ color: 'var(--c-muted)' }}>
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => handleDelete(i)} className="p-1.5 rounded hover:bg-white/5"
                          style={{ color: '#F44336' }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AnimatePresence>
        {modalEntry !== undefined && (
          <ScheduleModal
            entry={modalEntry}
            onSave={handleSave}
            onClose={() => { setModalEntry(undefined); setEditIndex(null) }}
          />
        )}
      </AnimatePresence>
    </SectionCard>
  )
}

// ── IR Learning ───────────────────────────────────────────────────────────────

function IRLearnSection({ sb }: { sb: SmartBuddyDevice }) {
  const [slot,    setSlot]    = useState('')
  const [pending, setPending] = useState(false)

  const learnMut = useMutation({
    mutationFn: () => triggerSmartBuddyIRLearn(sb.id, slot.trim()),
    onMutate:  () => setPending(true),
    onSuccess: (res) => { toast.success(res.message ?? 'IR learning started — point remote at device'); setSlot('') },
    onError:   (e: Error) => toast.error(e.message),
    onSettled: () => setPending(false),
  })

  return (
    <SectionCard title="IR Learning" icon={<Radio size={12} style={{ color: GOLD }} />}>
      <div className="p-4 flex flex-col gap-3">
        <p className="font-mono text-[10px]" style={{ color: 'var(--c-muted)' }}>
          Enter slot name, click Start, then point the original AC remote at the IR sensor within 10 seconds.
        </p>
        <div className="flex gap-3">
          <input
            value={slot}
            onChange={e => setSlot(e.target.value)}
            placeholder="Slot name (e.g. power_on_25)"
            className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
          />
          <button
            disabled={pending || !slot.trim() || !sb.online}
            onClick={() => learnMut.mutate()}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 transition-all"
            style={{
              background: (pending || !slot.trim() || !sb.online)
                ? 'var(--c-border)' : 'linear-gradient(135deg,#C9A84C,#E8C96A)',
              color: (pending || !slot.trim() || !sb.online) ? 'var(--c-faint)' : 'var(--bg-base)',
            }}>
            {pending ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SmartBuddyDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const { can, isAdmin } = usePermissions()
  const canControl = isAdmin || can('smartbuddy.control')

  const [pirMotion, setPirMotion]   = useState(false)
  const pirTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Edit modal state
  const [editOpen,         setEditOpen]        = useState(false)
  const [editName,         setEditName]        = useState('')
  const [editLocation,     setEditLocation]    = useState('')
  const [editSaving,       setEditSaving]      = useState(false)

  // Quick-create location inline
  const [locQuickOpen,     setLocQuickOpen]    = useState(false)
  const [locQuickName,     setLocQuickName]    = useState('')
  const [locQuickAddr,     setLocQuickAddr]    = useState('')
  const [locQuickCreating, setLocQuickCreating]= useState(false)

  // Delete modal state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  const { data: sb, isLoading, isError } = useQuery({
    queryKey: ['smartbuddy-device', Number(id)],
    queryFn:  () => getSmartBuddyDevice(Number(id)),
    refetchInterval: 30_000,
    enabled: !!id,
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn:  getLocations,
    enabled:  editOpen,
  })

  const handleSSE = useCallback((e: SSEEvent) => {
    const data = e.data as Record<string, unknown>
    if (!sb || data.device_id !== sb.device_id) return
    if (e.type === 'smartbuddy_status' || e.type === 'smartbuddy_ac' || e.type === 'smartbuddy_lamp') {
      qc.invalidateQueries({ queryKey: ['smartbuddy-device', Number(id)] })
    }
    if (e.type === 'smartbuddy_pir') {
      const motion = Boolean(data.motion)
      setPirMotion(motion)
      if (pirTimer.current) clearTimeout(pirTimer.current)
      if (motion) pirTimer.current = setTimeout(() => setPirMotion(false), 10_000)
    }
  }, [sb, qc, id])
  useSSE(handleSSE, '/api/smartbuddy/events')

  function openEdit() {
    setEditName(sb?.name ?? '')
    setEditLocation(sb?.location_id ?? '')
    setEditOpen(true)
  }

  async function handleEdit() {
    setEditSaving(true)
    try {
      await updateSmartBuddyDevice(Number(id), {
        name:     editName || undefined,
        location: editLocation || undefined,
      })
      await qc.invalidateQueries({ queryKey: ['smartbuddy-device', Number(id)] })
      setEditOpen(false)
      toast.success('Device updated')
    } catch {
      toast.error('Failed to update device')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteSmartBuddyDevice(Number(id))
      toast.success('Device deleted')
      navigate('/smartbuddy')
    } catch {
      toast.error('Failed to delete device')
    } finally {
      setDeleting(false)
    }
  }

  async function handleQuickCreateLocation() {
    if (!locQuickName.trim()) { toast.error('Location name is required'); return }
    setLocQuickCreating(true)
    try {
      const created = await createLocation(locQuickName.trim(), locQuickAddr.trim() || undefined)
      qc.invalidateQueries({ queryKey: ['locations'] })
      setEditLocation(created.id)
      setLocQuickOpen(false)
      setLocQuickName('')
      setLocQuickAddr('')
      toast.success('Location created')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create location')
    } finally {
      setLocQuickCreating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-32">
        <p className="font-mono text-sm" style={{ color: 'var(--c-muted)' }}>Loading device...</p>
      </div>
    )
  }

  if (isError || !sb) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-32 gap-4">
        <AlertCircle size={32} style={{ color: '#F44336' }} />
        <p className="font-mono text-sm" style={{ color: 'var(--c-muted)' }}>Device not found</p>
        <button onClick={() => navigate('/smartbuddy')}
          className="font-mono text-sm" style={{ color: GOLD }}>
          ← Back
        </button>
      </div>
    )
  }

  const capabilities = [sb.has_ac && 'AC', sb.has_lamp && 'Lamp'].filter(Boolean).join(' + ') || '—'

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky header */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: 'rgba(var(--bg-surface-rgb),0.95)', borderColor: 'var(--c-border)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/smartbuddy')}
            className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-white text-lg font-semibold leading-none">{sb.name}</h1>
            {(sb.location_name || sb.room_id) && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin size={10} style={{ color: 'var(--c-muted)' }} />
                <span className="font-mono text-[10px]" style={{ color: 'var(--c-muted)' }}>
                  {sb.location_name ?? sb.room_id?.replace(/_/g, ' ')}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
            style={{
              background: sb.online ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.10)',
              border: `1px solid ${sb.online ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.25)'}`,
            }}>
            <motion.span className="w-1.5 h-1.5 rounded-full"
              style={{ background: sb.online ? '#4CAF50' : '#F44336' }}
              animate={sb.online ? { opacity: [1, 0.4, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
            />
            <span className="font-mono text-[10px] font-bold uppercase"
              style={{ color: sb.online ? '#4CAF50' : '#F44336' }}>
              {sb.online ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
            {sb.last_seen ? `Last seen: ${fmtTime(sb.last_seen)}` : ''}
          </span>
          <button className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col gap-5 max-w-5xl">

        {/* Offline warning */}
        {!sb.online && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.25)' }}>
            <AlertCircle size={14} style={{ color: '#F44336' }} />
            <p className="font-mono text-xs" style={{ color: '#F44336' }}>
              Device offline — commands will be sent when device reconnects via MQTT sync
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sb.has_ac   && <ACControlSection   sb={sb} canControl={canControl} />}
          {sb.has_lamp && <LampControlSection sb={sb} canControl={canControl} pirMotion={pirMotion} />}
        </div>

        {/* Schedule */}
        <ScheduleSection sb={sb} canControl={canControl} />

        {/* IR Learning */}
        {sb.has_ac && canControl && <IRLearnSection sb={sb} />}

        {/* Device Info — 2×2 grid matching scale device layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="Device Identity">
            <InfoRow label="Name"       value={sb.name} />
            <InfoRow label="MAC Address" value={sb.mac} />
            <InfoRow label="Device ID"  value={sb.device_id} />
          </SectionCard>

          <SectionCard title="Network">
            <InfoRow label="IP Address" value={sb.ip_address ?? '—'} />
            <InfoRow label="Room ID"    value={sb.room_id ?? '—'} mono={false} />
            <InfoRow label="Location"   value={sb.location_name ?? '—'} mono={false} />
          </SectionCard>

          <SectionCard title="Hardware & Firmware">
            <InfoRow label="Chip"             value="ESP32" />
            <InfoRow label="Firmware Version" value={sb.firmware ?? '—'} />
            {sb.has_ac && (
              <InfoRow label="AC Brand" value={BRAND_LABEL[sb.ac_brand] ?? sb.ac_brand} mono={false} />
            )}
          </SectionCard>

          <SectionCard title="Capabilities">
            <InfoRow label="AC Control"   value={sb.has_ac   ? 'Yes' : 'No'} mono={false} />
            <InfoRow label="Lamp Control" value={sb.has_lamp ? 'Yes' : 'No'} mono={false} />
            <InfoRow label="Summary"      value={capabilities} mono={false} />
          </SectionCard>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 pb-6">
          {(isAdmin || can('smartbuddy.ota')) && (
            <button onClick={() => navigate('/smartbuddy/ota')}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
              style={{ border: `1px solid ${GOLD}55`, color: GOLD }}>
              <ArrowUpCircle size={15} />
              OTA Update
            </button>
          )}
          {canControl && (
            <button onClick={openEdit}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
              style={{ border: `1px solid ${GOLD}55`, color: GOLD }}>
              <Edit2 size={15} />
              Edit
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-red-500/10"
              style={{ border: '1px solid rgba(244,67,54,0.35)', color: '#F44336' }}>
              <Trash2 size={15} />
              Delete
            </button>
          )}
        </div>

        {/* ── Edit Modal ── */}
        <AnimatePresence>
          {editOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
              onClick={() => setEditOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold">Edit Device</h3>
                  <button onClick={() => setEditOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    style={{ color: 'var(--c-muted)' }}>
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                      Name
                    </label>
                    <input
                      type="text" value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = GOLD)}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                        Location
                      </label>
                      <button
                        type="button"
                        onClick={() => { setLocQuickName(''); setLocQuickAddr(''); setLocQuickOpen(true) }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono transition-colors hover:bg-white/5"
                        style={{ color: GOLD, border: `1px solid rgba(201,168,76,0.25)` }}>
                        <Plus size={10} />
                        New
                      </button>
                    </div>
                    <select
                      value={editLocation}
                      onChange={e => setEditLocation(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all appearance-none"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = GOLD)}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                    >
                      <option value="">— None —</option>
                      {locations.map(loc => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setEditOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleEdit}
                    disabled={editSaving}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${GOLD}, #E8C96A)`, color: 'var(--bg-base)' }}>
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Quick Create Location ── */}
        <AnimatePresence>
          {locQuickOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
              onClick={() => setLocQuickOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-xs p-5 rounded-2xl flex flex-col gap-4"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-white text-sm font-semibold">New Location</h4>
                  <button onClick={() => setLocQuickOpen(false)}
                    className="p-1 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--c-muted)' }}>
                    <X size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Name</label>
                    <input
                      type="text" value={locQuickName} onChange={e => setLocQuickName(e.target.value)}
                      placeholder="e.g. Server Room" autoFocus
                      className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = GOLD)}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                      onKeyDown={e => e.key === 'Enter' && handleQuickCreateLocation()}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Address (optional)</label>
                    <input
                      type="text" value={locQuickAddr} onChange={e => setLocQuickAddr(e.target.value)}
                      placeholder="123 Example St"
                      className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = GOLD)}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setLocQuickOpen(false)}
                    className="flex-1 py-2 rounded-xl text-sm font-medium"
                    style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleQuickCreateLocation}
                    disabled={locQuickCreating}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${GOLD}, #E8C96A)`, color: 'var(--bg-base)' }}>
                    {locQuickCreating ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Delete Confirm ── */}
        <AnimatePresence>
          {deleteOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
              onClick={() => setDeleteOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
                style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(244,67,54,0.35)' }}
                onClick={e => e.stopPropagation()}
              >
                <div>
                  <h3 className="text-white font-semibold">Delete Device?</h3>
                  <p className="text-sm mt-2" style={{ color: 'var(--c-muted)' }}>
                    Device <span className="text-white font-medium">{sb.name}</span> will be
                    permanently deleted. This action cannot be undone.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'rgba(244,67,54,0.90)', color: 'var(--c-primary)' }}>
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}
