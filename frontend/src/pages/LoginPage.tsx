import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { LogIn, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { loginWithOdoo } from '@/lib/api'
import { setToken } from '@/lib/auth'
import logoImg from '@/assets/logo.png'

/* ── Animations ── */
const slideLeft: Variants = {
  hidden:  { opacity: 0, x: -32 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: 'easeOut' } },
}
const slideRight: Variants = {
  hidden:  { opacity: 0, x: 32 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, delay: 0.1, ease: 'easeOut' } },
}
const stagger: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.35 } },
}
const field: Variants = {
  hidden:  { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

/* ── Input field ── */
function Field({
  label, id, type = 'text', placeholder, icon: Icon, value, onChange, hint,
}: {
  label: string; id: string; type?: string; placeholder: string
  icon: typeof Mail; value: string
  onChange: (v: string) => void; hint?: React.ReactNode
}) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  const inputType  = isPassword ? (show ? 'text' : 'password') : type

  return (
    <motion.div variants={field} className="flex flex-col gap-1.5">
      <div className="flex items-end justify-between">
        <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
          {label}
        </label>
        {hint}
      </div>
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--c-muted)' }}>
          <Icon size={14} />
        </div>
        <input
          id={id}
          type={inputType}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full pl-10 pr-10 py-3.5 rounded-xl text-sm font-sans focus:outline-none transition-all duration-200"
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-primary)',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = '#C9A84C'
            e.currentTarget.style.boxShadow   = '0 0 0 3px rgba(201,168,76,0.10)'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--c-border)'
            e.currentTarget.style.boxShadow   = 'none'
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
            style={{ color: 'var(--c-muted)' }}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </motion.div>
  )
}

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { access_token } = await loginWithOdoo(email, password)
      setToken(access_token)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex overflow-hidden" style={{ background: 'var(--bg-base)' }}>

      {/* ── Left Hero Panel ── */}
      <motion.div
        variants={slideLeft} initial="hidden" animate="visible"
        className="hidden lg:flex w-[55%] relative flex-col justify-between p-14 overflow-hidden"
        style={{ background: 'var(--bg-hero)' }}
      >
        {/* Gradient overlays */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 80% 70% at 30% 60%, rgba(201,168,76,0.07) 0%, transparent 65%)',
        }}/>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 50% at 80% 20%, rgba(74,144,217,0.06) 0%, transparent 60%)',
        }}/>
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.025] pointer-events-none" style={{
          backgroundImage: `linear-gradient(rgba(201,168,76,1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(201,168,76,1) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}/>
        {/* Gold accent top bar */}
        <div className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: 'linear-gradient(90deg, transparent, #C9A84C 40%, #4A90D9 80%, transparent)' }}
        />

        {/* Brand mark */}
        <div className="relative">
          <p className="text-white text-3xl font-black leading-none tracking-tight">KAIIS</p>
          <p className="font-mono text-[10px] uppercase tracking-widest mt-1" style={{ color: '#C9A84C' }}>
            Kapitmas IoT Integrated System
          </p>
        </div>

        {/* Center: Hero visual */}
        <div className="flex flex-col items-center gap-6 relative">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            <img src={logoImg} alt="Kapitmas" className="w-28 h-28 object-contain" />
          </motion.div>

          <h1 className="text-4xl font-bold text-center leading-snug max-w-md">
            <span className="text-white">Powering </span>
            <span style={{ color: '#C9A84C' }}>Kapitmas</span>
            <br />
            <span className="text-white">Operations</span>
          </h1>
          <p className="text-center text-sm leading-relaxed max-w-sm" style={{ color: 'var(--c-muted)' }}>
            Enterprise IoT management for Bali's trusted ethical jewelry manufacturer.
            Monitor devices, scales, and production metrics in real time.
          </p>
        </div>

        {/* Stats strip */}
        <div
          className="relative flex rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--c-border)', background: 'rgba(var(--bg-surface-rgb),0.60)', backdropFilter: 'blur(8px)' }}
        >
          {[
            { label: 'Devices',  value: '42' },
            { label: 'Uptime',   value: '99.9%' },
            { label: 'Platform', value: 'v2.1' },
          ].map(({ label, value }, i) => (
            <div key={label} className="flex-1 px-6 py-4" style={i > 0 ? { borderLeft: '1px solid var(--c-border)' } : {}}>
              <p className="font-mono text-xs uppercase tracking-wider" style={{ color: 'var(--c-muted)' }}>{label}</p>
              <p className="font-mono text-xl font-bold mt-1" style={{ color: '#C9A84C' }}>{value}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Right Login Panel ── */}
      <motion.div
        variants={slideRight} initial="hidden" animate="visible"
        className="flex-1 flex items-center justify-center px-8 py-12 relative"
        style={{ background: 'var(--bg-base)' }}
      >
        {/* Subtle top border accent */}
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.35) 50%, transparent)' }}
        />

        <div className="w-full max-w-sm flex flex-col gap-8">

          {/* Mobile: KAIIS brand */}
          <div className="lg:hidden flex items-center gap-3">
            <img src={logoImg} alt="Kapitmas" className="w-7 h-7 object-contain" />
            <div>
              <p className="text-white text-xl font-black leading-none">KAIIS</p>
              <p className="font-mono text-[9px] uppercase tracking-widest mt-0.5" style={{ color: '#C9A84C' }}>
                IoT Integrated System
              </p>
            </div>
          </div>

          {/* Header */}
          <div>
            <h2 className="text-white text-2xl font-bold leading-tight">Access Portal</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--c-muted)' }}>
              Sign in to the KAIIS operational network
            </p>
          </div>

          {/* Form */}
          <motion.form
            onSubmit={handleSubmit}
            variants={stagger} initial="hidden" animate="visible"
            className="flex flex-col gap-4"
          >
            <Field
              label="Email Address" id="email" type="email"
              placeholder="admin@kapitmas.id"
              icon={Mail} value={email} onChange={setEmail}
            />

            <Field
              label="Password" id="password" type="password"
              placeholder="••••••••••••"
              icon={Lock} value={password} onChange={setPassword}
              hint={
                <button type="button"
                  className="font-mono text-[10px] uppercase tracking-wider transition-colors hover:opacity-80"
                  style={{ color: 'var(--c-muted)' }}
                >
                  Forgot?
                </button>
              }
            />

            {/* Sign In button */}
            <motion.div variants={field} className="pt-1">
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.015 }}
                whileTap={{   scale: loading ? 1 : 0.98  }}
                className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2
                           transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #C9A84C, #E8C96A)',
                  color: 'var(--bg-base)',
                }}
              >
                {loading ? (
                  <motion.div
                    className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'rgba(var(--bg-base-rgb),0.3)', borderTopColor: 'var(--bg-base)' }}
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                  />
                ) : (
                  <>
                    <span>Sign In</span>
                    <LogIn size={15} />
                  </>
                )}
              </motion.button>
            </motion.div>

            {/* Status pill */}
            <motion.div
              variants={field}
              className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}
            >
              <div className="flex items-center gap-2">
                <motion.span
                  className="w-2 h-2 rounded-full"
                  style={{ background: '#4CAF50' }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                />
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-muted)' }}>
                  System Operational
                </span>
              </div>
              <span className="font-mono text-[10px]" style={{ color: 'var(--c-border)' }}>KAIIS v2.1</span>
            </motion.div>
          </motion.form>

          {/* Footer: Powered by KAPITMAS */}
          <div className="flex items-center justify-center gap-2.5 pt-2">
            <img src={logoImg} alt="Kapitmas" className="w-5 h-5 object-contain" />
            <div className="text-center">
              <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-faint)' }}>Powered by</p>
              <p className="font-bold text-xs" style={{ color: '#C9A84C' }}>KAPITMAS</p>
            </div>
            <img src={logoImg} alt="Kapitmas" className="w-5 h-5 object-contain" />
          </div>

        </div>
      </motion.div>

    </div>
  )
}
