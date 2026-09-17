import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scale, Wifi, WifiOff, Radio, Cpu, HardDrive, Bot, DoorOpen, Lightbulb, Wind, ChevronLeft, ChevronRight, MemoryStick } from 'lucide-react'
import type { SystemHealth } from '@/lib/api'

// Helper: color by percentage
function pctColor(pct: number): string {
  if (pct < 60) return '#4CAF50'
  if (pct < 80) return '#FFC107'
  return '#F44336'
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1 rounded-full mt-2" style={{ background: 'var(--bg-base)' }}>
      <div className="h-1 rounded-full transition-all duration-700"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  )
}

interface CardProps {
  label: string
  value: React.ReactNode
  sub?: string
  Icon: React.ElementType
  accent: string
  pulse?: boolean
  progress?: number
  delay?: number
}

function HealthCard({ label, value, sub, Icon, accent, pulse, progress, delay = 0 }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="relative p-4 rounded-xl flex flex-col gap-2 overflow-hidden"
      style={{ background: 'var(--bg-base)', border: `1px solid var(--c-border)`, borderTop: `2px solid ${accent}` }}
    >
      <div className="absolute right-3 bottom-3 opacity-[0.06] pointer-events-none" style={{ color: accent }}>
        <Icon size={40} />
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>{label}</span>
        <div className="w-6 h-6 flex items-center justify-center rounded-md" style={{ background: `${accent}18`, color: accent }}>
          <Icon size={11} />
        </div>
      </div>
      <div>
        <div className="flex items-end gap-1.5">
          <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: 'var(--c-primary)' }}>{value}</span>
          {pulse && (
            <motion.span className="w-1.5 h-1.5 rounded-full mb-1.5" style={{ background: accent }}
              animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} />
          )}
        </div>
        {sub && <p className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--c-muted)' }}>{sub}</p>}
        {progress !== undefined && <ProgressBar pct={progress} color={accent} />}
      </div>
    </motion.div>
  )
}

function SoonCard({ label, Icon, delay = 0 }: { label: string; Icon: React.ElementType; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="relative p-4 rounded-xl flex flex-col items-center justify-center gap-2 overflow-hidden"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', opacity: 0.55 }}
    >
      <Icon size={22} style={{ color: 'var(--c-faint)' }} />
      <span className="font-mono text-[10px] font-semibold" style={{ color: 'var(--c-faint)' }}>{label}</span>
      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded font-mono text-[8px] font-bold uppercase"
        style={{ background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.20)' }}>
        Soon
      </span>
    </motion.div>
  )
}

interface Props { health: SystemHealth }

const SLIDE_TITLES = ['IoT Devices', 'System Resources', 'Coming Soon']
const INTERVAL_MS  = 5000

export default function SystemHealthPanel({ health }: Props) {
  const [[page, dir], setPage] = useState([0, 0])
  const [hovering, setHovering] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const total = SLIDE_TITLES.length

  function paginate(newDir: number) {
    setPage(([p]) => [(p + newDir + total) % total, newDir])
  }

  useEffect(() => {
    if (hovering) return
    timer.current = setInterval(() => paginate(1), INTERVAL_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [hovering])

  const slides = [
    // Slide 0: IoT Devices
    <div key="s0" className="grid grid-cols-2 gap-3">
      <HealthCard label="Scale Devices" value={health.devices.timbangan.total}
        Icon={Scale} accent="#C9A84C" delay={0}
        sub={`${health.devices.timbangan.online} online`}
        pulse={health.devices.timbangan.online > 0} />
      <HealthCard label="SmartBuddy" value={health.devices.smartbuddy.total}
        Icon={Bot} accent="#26C6DA" delay={0.05}
        sub={`${health.devices.smartbuddy.online} online`}
        pulse={health.devices.smartbuddy.online > 0} />
      <HealthCard label="Devices Online"
        value={(health.devices.timbangan.online + health.devices.smartbuddy.online)}
        Icon={Wifi} accent="#4CAF50" pulse delay={0.1} />
      <HealthCard label="MQTT Broker" value={health.mqtt.connected ? 'Connected' : 'Offline'}
        Icon={Radio} accent={health.mqtt.connected ? '#4CAF50' : '#F44336'}
        pulse={health.mqtt.connected} delay={0.15} />
    </div>,

    // Slide 1: System
    <div key="s1" className="grid grid-cols-2 gap-3">
      <HealthCard label="CPU" value={`${health.cpu.percent.toFixed(1)}%`}
        Icon={Cpu} accent={pctColor(health.cpu.percent)}
        progress={health.cpu.percent} sub={`${health.cpu.cores} cores`} delay={0} />
      <HealthCard label="Memory" value={`${health.ram.percent.toFixed(1)}%`}
        Icon={MemoryStick} accent={pctColor(health.ram.percent)}
        progress={health.ram.percent} sub={`${health.ram.used_gb}/${health.ram.total_gb} GB`} delay={0.05} />
      <HealthCard label="Storage" value={`${health.disk.percent.toFixed(1)}%`}
        Icon={HardDrive} accent={pctColor(health.disk.percent)}
        progress={health.disk.percent} sub={`${health.disk.free_gb} GB free`} delay={0.1} />
      <HealthCard label="Devices Offline"
        value={(health.devices.timbangan.offline + health.devices.smartbuddy.offline)}
        Icon={WifiOff}
        accent={(health.devices.timbangan.offline + health.devices.smartbuddy.offline) > 0 ? '#F44336' : 'var(--c-muted)'}
        delay={0.15} />
    </div>,

    // Slide 2: Coming Soon
    <div key="s2" className="grid grid-cols-2 gap-3">
      <SoonCard label="Door Lock"   Icon={DoorOpen}  delay={0} />
      <SoonCard label="Smart Lamp"  Icon={Lightbulb} delay={0.05} />
      <SoonCard label="AC Remote"   Icon={Wind}      delay={0.1} />
      <SoonCard label="More…"       Icon={Bot}       delay={0.15} />
    </div>,
  ]

  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-xl select-none"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded-full" style={{ background: '#C9A84C' }} />
          <h2 className="text-white text-base font-semibold">System Health</h2>
          <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ background: 'rgba(201,168,76,0.10)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.20)' }}>
            {SLIDE_TITLES[page]}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {SLIDE_TITLES.map((_, i) => (
              <button key={i} onClick={() => setPage([i, i > page ? 1 : -1])}
                className="rounded-full transition-all"
                style={{
                  width: i === page ? 16 : 6,
                  height: 6,
                  background: i === page ? '#C9A84C' : 'var(--c-border)',
                }} />
            ))}
          </div>
          {/* Arrows */}
          <div className="flex gap-1">
            {[{ dir: -1, Icon: ChevronLeft }, { dir: 1, Icon: ChevronRight }].map(({ dir: d, Icon }) => (
              <button key={d} onClick={() => paginate(d)}
                className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors hover:bg-white/5"
                style={{ color: 'var(--c-muted)' }}>
                <Icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Slide area */}
      <div className="overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="wait">
          <motion.div
            key={page}
            custom={dir}
            initial={{ x: dir > 0 ? '100%' : '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir > 0 ? '-100%' : '100%', opacity: 0 }}
            transition={{ type: 'tween', ease: 'easeInOut', duration: 0.35 }}
          >
            {slides[page]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
