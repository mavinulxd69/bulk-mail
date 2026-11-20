#!/usr/bin/env bash
# MailPilot — complete project generator
set -euo pipefail
ROOT="${1:-mailpilot}"
mkdir -p "$ROOT" && cd "$ROOT"
mkdir -p app/{"(auth)"/{login,signup,forgot-password,reset-password},auth/callback,dashboard/{compose,campaigns/"[id]",contacts,senders,templates,activity,settings},admin,unsubscribe,api/{oauth/google/{start,callback},ai/draft,webhooks/{resend,gmail}}} \
         components/ui lib/{supabase,auth,crypto,security,personalization,providers,ai,queue} \
         config scripts supabase/{migrations,tests} worker tests/unit

w() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

# ============================================================ CONFIG
w package.json <<'__END__'
{
  "name": "mailpilot",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "bootstrap": "bash scripts/bootstrap.sh",
    "worker:dev": "tsx worker/index.ts",
    "worker:build": "tsc -p worker/tsconfig.json",
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "db:push": "supabase db push"
  },
  "dependencies": {
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.45.4",
    "@upstash/ratelimit": "^2.0.5",
    "@upstash/redis": "^1.34.3",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.460.0",
    "next": "^15.1.0",
    "next-themes": "^0.4.3",
    "papaparse": "^5.4.1",
    "pg": "^8.13.1",
    "pg-boss": "^10.1.5",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "server-only": "^0.0.1",
    "tailwind-merge": "^2.5.4",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/papaparse": "^5.3.15",
    "@types/pg": "^8.11.10",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
__END__

w tsconfig.json <<'__END__'
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false, "skipLibCheck": true, "strict": true, "noEmit": true,
    "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve",
    "incremental": true, "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "worker", "dist-worker"]
}
__END__

w next.config.ts <<'__END__'
import type { NextConfig } from 'next'
const config: NextConfig = { reactStrictMode: true, serverExternalPackages: ['pg', 'pg-boss'] }
export default config
__END__

w postcss.config.mjs <<'__END__'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
__END__

w tailwind.config.ts <<'__END__'
import type { Config } from 'tailwindcss'
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      background: 'hsl(var(--background))', foreground: 'hsl(var(--foreground))',
      card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
      muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
      border: 'hsl(var(--border))'
    },
    borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' }
  }},
  plugins: [require('tailwindcss-animate')]
}
export default config
__END__

w middleware.ts <<'__END__'
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
export async function middleware(r: NextRequest) { return updateSession(r) }
export const config = { matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] }
__END__

w .gitignore <<'__END__'
node_modules
.next
out
dist-worker
*.tsbuildinfo
next-env.d.ts
.env
.env.local
.env.*.local
!.env.example
.DS_Store
*.log
coverage
__END__

w .env.example <<'__END__'
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
TOKEN_ENCRYPTION_KEY=
UNSUBSCRIBE_JWT_SECRET=
OAUTH_STATE_SECRET=
ADMIN_EMAILS=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
AI_PROVIDER=openai
AI_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
USER_DAILY_LIMIT=100
__END__

# ============================================================ LIB
w lib/utils.ts <<'__END__'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...i: ClassValue[]) { return twMerge(clsx(i)) }
__END__

w lib/env.ts <<'__END__'
import 'server-only'
import { z } from 'zod'
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  UNSUBSCRIBE_JWT_SECRET: z.string().min(1),
  OAUTH_STATE_SECRET: z.string().min(32),
  ADMIN_EMAILS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  AI_PROVIDER: z.enum(['openai','anthropic','gemini']).optional(),
  AI_API_KEY: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
})
let cached: z.infer<typeof schema> | null = null
export function env() {
  if (cached) return cached
  const r = schema.safeParse(process.env)
  if (!r.success) { console.error('env:', r.error.flatten().fieldErrors); throw new Error('Invalid env') }
  cached = r.data; return cached
}
__END__

w lib/database.types.ts <<'__END__'
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; display_name: string | null; created_at: string }
        Insert: { id: string; email: string; display_name?: string | null }
        Update: { display_name?: string | null }
      }
      sender_accounts: {
        Row: { id: string; user_id: string; provider: 'gmail'|'resend'; display_name: string;
          from_email: string; from_name: string|null; reply_to: string|null;
          encrypted_refresh_token: string|null; token_iv: string|null; token_tag: string|null;
          gmail_watch_expires_at: string|null; sender_domain_id: string|null;
          status: 'active'|'revoked'|'error'; last_error: string|null;
          created_at: string; updated_at: string }
        Insert: { user_id: string; provider: 'gmail'|'resend'; display_name: string; from_email: string;
          id?: string; status?: 'active'|'revoked'|'error'; encrypted_refresh_token?: string|null;
          token_iv?: string|null; token_tag?: string|null; from_name?: string|null; reply_to?: string|null }
        Update: Record<string, unknown>
      }
      contacts: {
        Row: { id: string; user_id: string; email: string; name: string|null; company: string|null;
          custom_fields: Record<string,string>; consent_source: string; consented_at: string;
          consent_confirmed: boolean; created_at: string; updated_at: string }
        Insert: { user_id: string; email: string; name?: string|null; company?: string|null;
          custom_fields?: Record<string,string>; consent_source: string; consent_confirmed: boolean }
        Update: Record<string, unknown>
      }
      contact_lists: {
        Row: { id: string; user_id: string; name: string; description: string|null; created_at: string }
        Insert: { user_id: string; name: string; description?: string|null }
        Update: Record<string, unknown>
      }
      contact_list_members: {
        Row: { contact_list_id: string; contact_id: string; user_id: string; added_at: string }
        Insert: { contact_list_id: string; contact_id: string; user_id: string }
        Update: Record<string, unknown>
      }
      email_templates: {
        Row: { id: string; user_id: string; name: string; subject: string; html_body: string;
          text_body: string; variables: string[]; created_at: string; updated_at: string }
        Insert: { user_id: string; name: string; subject?: string; html_body?: string;
          text_body?: string; variables?: string[] }
        Update: Record<string, unknown>
      }
      campaigns: {
        Row: { id: string; user_id: string; sender_account_id: string|null; name: string;
          status: 'draft'|'awaiting_approval'|'queued'|'sending'|'completed'|'partially_failed'|'failed'|'cancelled';
          subject: string; html_body: string; text_body: string;
          total_recipients: number; sent_count: number; failed_count: number;
          approved_at: string|null; completed_at: string|null;
          created_at: string; updated_at: string }
        Insert: { user_id: string; name: string; sender_account_id?: string|null; status?: string;
          subject?: string; html_body?: string; text_body?: string; total_recipients?: number }
        Update: Record<string, unknown>
      }
      campaign_recipients: {
        Row: { id: string; campaign_id: string; user_id: string; contact_id: string;
          rendered_subject: string; rendered_html: string; rendered_text: string;
          status: string; provider_message_id: string|null; last_error: string|null;
          created_at: string; updated_at: string }
        Insert: { campaign_id: string; user_id: string; contact_id: string;
          rendered_subject: string; rendered_html: string; rendered_text: string; status?: string }
        Update: Record<string, unknown>
      }
      sending_jobs: {
        Row: { id: string; user_id: string; campaign_recipient_id: string; idempotency_key: string;
          status: string; attempts: number; max_attempts: number; scheduled_at: string;
          locked_at: string|null; provider_handoff_started_at: string|null; last_error: string|null; provider_response: unknown; created_at: string; updated_at: string }
        Insert: { user_id: string; campaign_recipient_id: string; idempotency_key: string; status?: string }
        Update: Record<string, unknown>
      }
      sending_events: {
        Row: { id: string; user_id: string; sending_job_id: string; event_type: string;
          provider_event_id: string|null; provider_payload: unknown; occurred_at: string }
        Insert: { user_id: string; sending_job_id: string; event_type: string;
          provider_event_id?: string|null; provider_payload?: unknown }
        Update: Record<string, unknown>
      }
      suppressions: {
        Row: { id: string; user_id: string; email: string; reason: string; created_at: string }
        Insert: { user_id: string; email: string; reason: string }
        Update: Record<string, unknown>
      }
      consent_events: {
        Row: { id: string; user_id: string; contact_id: string; source: string; evidence: unknown; consented_at: string }
        Insert: { user_id: string; contact_id: string; source: string; evidence?: unknown }
        Update: Record<string, unknown>
      }
      usage_counters: {
        Row: { user_id: string; period_start: string; emails_sent: number; ai_drafts: number }
        Insert: { user_id: string; period_start: string; emails_sent?: number; ai_drafts?: number }
        Update: Record<string, unknown>
      }
      audit_logs: {
        Row: { id: string; user_id: string; action: string; entity_type: string|null;
          entity_id: string|null; metadata: unknown; created_at: string }
        Insert: never
        Update: never
      }
    }
    Views: Record<string, never>
    Functions: {
      record_audit: { Args: { p_user_id: string; p_action: string; p_entity_type: string|null; p_entity_id: string|null; p_metadata: Record<string, unknown> }; Returns: void }
      increment_usage: { Args: { p_user_id: string; p_date: string }; Returns: void }
      check_usage_quota: { Args: { p_user_id: string; p_daily_limit: number }; Returns: { allowed: boolean; used: number; limit: number } }
      reserve_usage_slot: { Args: { p_user_id: string; p_date: string; p_daily_limit: number }; Returns: boolean }
      claim_sending_job: { Args: { p_job_id: string }; Returns: unknown }
      begin_provider_handoff: { Args: { p_job_id: string }; Returns: boolean }
      settle_sending_job: { Args: { p_job_id: string; p_status: string; p_message: string }; Returns: undefined }
      record_provider_accepted: { Args: { p_job_id: string; p_message_id: string; p_response: unknown }; Returns: undefined }
    }
    Enums: Record<string, never>
  }
}
__END__

w lib/supabase/server.ts <<'__END__'
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/database.types'
export async function createSupabaseServer() {
  const c = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll: () => c.getAll(),
      setAll: (s) => { try { s.forEach(({ name, value, options }) => c.set(name, value, options)) } catch {} }
    } }
  )
}
__END__

w lib/supabase/browser.ts <<'__END__'
'use client'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
export function createSupabaseBrowser() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
__END__

w lib/supabase/admin.ts <<'__END__'
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
export function createSupabaseAdmin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
__END__

w lib/supabase/middleware.ts <<'__END__'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (s) => {
        s.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        s.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      }
    } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  const p = request.nextUrl.pathname
  if ((p.startsWith('/dashboard') || p.startsWith('/admin')) && !user) {
    const r = request.nextUrl.clone(); r.pathname = '/login'
    r.searchParams.set('next', p); return NextResponse.redirect(r)
  }
  if (['/login','/signup','/forgot-password'].includes(p) && user) {
    const r = request.nextUrl.clone(); r.pathname = '/dashboard'; return NextResponse.redirect(r)
  }
  return response
}
__END__

w lib/auth/require-user.ts <<'__END__'
import 'server-only'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
export async function requireUser() {
  const supabase = await createSupabaseServer()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')
  return { user, supabase }
}
export async function requireUserOr401() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  return { user, supabase }
}
export function isAdmin(user: { email?: string | null }) {
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return !!user.email && admins.includes(user.email)
}
__END__

w lib/crypto/token-vault.ts <<'__END__'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
const ALGO = 'aes-256-gcm'
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY not set')
  const b = Buffer.from(raw, 'base64')
  if (b.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)')
  return b
}
export interface EncryptedTriple { ciphertext: string; iv: string; tag: string }
export function encryptToken(plaintext: string, aad: string): EncryptedTriple {
  const iv = randomBytes(12), c = createCipheriv(ALGO, key(), iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') }
}
export function decryptToken(t: EncryptedTriple, aad: string): string {
  const d = createDecipheriv(ALGO, key(), Buffer.from(t.iv, 'base64'))
  d.setAAD(Buffer.from(aad)); d.setAuthTag(Buffer.from(t.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(t.ciphertext, 'base64')), d.final()]).toString('utf8')
}
__END__

w lib/security/escape.ts <<'__END__'
const M: Record<string,string> = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }
export function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => M[c]) }
__END__

w lib/security/audit.ts <<'__END__'
import 'server-only'
import { createSupabaseServer } from '@/lib/supabase/server'
export async function audit(userId: string, action: string, entityType?: string, entityId?: string, metadata?: Record<string, unknown>) {
  const s = await createSupabaseServer()
  await s.rpc('record_audit' as never, {
    p_user_id: userId, p_action: action,
    p_entity_type: entityType ?? null, p_entity_id: entityId ?? null, p_metadata: metadata ?? {},
  } as never)
}
__END__

w lib/security/oauth-state.ts <<'__END__'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function secret() {
  const value = process.env.OAUTH_STATE_SECRET
  if (!value || value.length < 32) throw new Error('OAUTH_STATE_SECRET must contain at least 32 characters')
  return value
}
export function makeOAuthState(userId: string): string {
  const body = Buffer.from(JSON.stringify({ userId, nonce: randomBytes(24).toString('base64url'), exp: Date.now() + 600_000 })).toString('base64url')
  const signature = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${signature}`
}
export function verifyOAuthState(state: string, expectedUserId: string): boolean {
  try {
    const parts = state.split('.')
    if (parts.length !== 2) return false
    const [body, signature] = parts
    const expected = createHmac('sha256', secret()).update(body).digest('base64url')
    const actualBytes = Buffer.from(signature, 'base64url')
    const expectedBytes = Buffer.from(expected, 'base64url')
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { userId?: string; exp?: number; nonce?: string }
    return payload.userId === expectedUserId && typeof payload.nonce === 'string' && Number.isFinite(payload.exp) && Date.now() <= Number(payload.exp)
  } catch { return false }
}
__END__

w lib/security/rate-limit.ts <<'__END__'
import 'server-only'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

type RateLimitResult = { success: boolean; reset: number }
type Limiter = { limit: (key: string) => Promise<RateLimitResult> }
let redisClient: Redis | null = null
const memoryWindows = new Map<string, number[]>()

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  if (!redisClient) redisClient = new Redis({ url, token })
  return redisClient
}

function make(limit: number, window: `${number} ${'s'|'m'|'h'}`, prefix: string): Limiter {
  return {
    async limit(key: string) {
      const redis = getRedis()
      if (redis) {
        const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix })
        return rl.limit(key)
      }
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Distributed rate limiting is not configured. Set both Upstash Redis variables.')
      }
      // Local development fallback only. It is process-local and not suitable for production.
      const durationMs = Number(window.split(' ')[0]) * (window.endsWith('h') ? 3_600_000 : window.endsWith('m') ? 60_000 : 1_000)
      const now = Date.now()
      const bucketKey = `${prefix}:${key}`
      const current = (memoryWindows.get(bucketKey) ?? []).filter(t => now - t < durationMs)
      if (current.length >= limit) {
        memoryWindows.set(bucketKey, current)
        return { success: false, reset: current[0] + durationMs }
      }
      current.push(now)
      memoryWindows.set(bucketKey, current)
      return { success: true, reset: now + durationMs }
    },
  }
}

export const aiDraftLimiter = make(20, '1 h', 'rl:ai')
export const campaignCreateLimiter = make(10, '1 h', 'rl:campaign')
export const testSendLimiter = make(5, '1 h', 'rl:test')

export async function checkLimit(limiter: Limiter, key: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const { success, reset } = await limiter.limit(key)
  if (success) return { ok: true }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) }
}
__END__

w lib/personalization/errors.ts <<'__END__'
export class MissingVariableError extends Error {
  constructor(public variable: string) { super(`Missing variable: ${variable}`); this.name = 'MissingVariableError' }
}
__END__

w lib/personalization/render.ts <<'__END__'
import { escapeHtml } from '@/lib/security/escape'
import { MissingVariableError } from './errors'
const RE = /\{\{\s*([\w.]+)\s*\}\}/g
export function extractVariables(t: string): string[] { return [...new Set([...t.matchAll(RE)].map(m => m[1]))] }
function render(t: string, d: Record<string, string|undefined>, esc: boolean) {
  return t.replace(RE, (_, k: string) => {
    const v = d[k]; if (v === undefined || v === '') throw new MissingVariableError(k)
    return esc ? escapeHtml(v) : v
  })
}
export function sanitizeSubject(s: string) { return s.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim() }
export function renderSubject(t: string, d: Record<string, string|undefined>) { return sanitizeSubject(render(t, d, false)) }
export function renderHtml(t: string, d: Record<string, string|undefined>) { return render(t, d, true) }
export function renderText(t: string, d: Record<string, string|undefined>) { return render(t, d, false) }
export function buildRecipientData(c: { email: string; name: string|null; company: string|null; custom_fields: Record<string,string> }) {
  const b: Record<string,string> = { ...c.custom_fields }
  b.email = c.email
  if (c.name) b.name = c.name
  if (c.company) b.company = c.company
  return b
}
__END__

w lib/personalization/unsubscribe.ts <<'__END__'
import { createHmac } from 'node:crypto'
import { escapeHtml } from '@/lib/security/escape'
export function signUnsubscribe(contactId: string, userId: string) {
  const s = process.env.UNSUBSCRIBE_JWT_SECRET; if (!s) throw new Error('UNSUBSCRIBE_JWT_SECRET not set')
  const p = JSON.stringify({ contactId, userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 })
  const b = Buffer.from(p).toString('base64url')
  return `${b}.${createHmac('sha256', s).update(b).digest('base64url')}`
}
export function buildUnsubscribeUrl(contactId: string, userId: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/unsubscribe?token=${encodeURIComponent(signUnsubscribe(contactId, userId))}`
}
export function ensureUnsubscribeFooter(html: string, url: string) {
  const safe = escapeHtml(url)
  if (html.includes('{{unsubscribe_url}}')) return html
  return html + `<div style="font-size:12px;color:#6b7280;margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-family:system-ui,sans-serif">You received this because you opted in. <a href="${safe}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>.</div>`
}
__END__

w lib/providers/types.ts <<'__END__'
export interface SendParams {
  to: string; subject: string; html: string; text: string
  fromEmail: string; fromName?: string|null; replyTo?: string|null
  unsubscribeUrl: string
  idempotencyKey: string
}
export interface SendResult { providerMessageId: string; raw: unknown }
export interface EmailProvider { send(p: SendParams, c: ProviderCredentials): Promise<SendResult> }
export type ProviderCredentials = { kind: 'gmail'; refreshToken: string } | { kind: 'resend'; apiKey: string }
export class ProviderError extends Error {
  constructor(message: string, public status: number, public retryAfterSeconds?: number) {
    super(message); this.name = 'ProviderError'
  }
}
__END__

w lib/providers/gmail.ts <<'__END__'
import { randomUUID } from 'node:crypto'
import { ProviderError, type EmailProvider, type SendParams, type SendResult } from './types'

function stripCRLF(value: string) { return value.replace(/[\r\n]+/g, ' ').trim() }
function encodeHeader(value: string): string {
  const safe = stripCRLF(value)
  return /^[\x00-\x7F]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`
}
function buildMime(p: SendParams): string {
  const fromName = p.fromName ? `${encodeHeader(p.fromName)} ` : ''
  const from = `${fromName}<${stripCRLF(p.fromEmail)}>`
  const boundary = `boundary-${randomUUID()}`
  const headers = [
    `From: ${from}`,
    `To: ${stripCRLF(p.to)}`,
    `Subject: ${encodeHeader(p.subject)}`,
    'MIME-Version: 1.0',
    `List-Unsubscribe: <${stripCRLF(p.unsubscribeUrl)}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  if (p.replyTo) headers.push(`Reply-To: ${stripCRLF(p.replyTo)}`)
  const body =
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${p.text}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${p.html}\r\n` +
    `--${boundary}--`
  return headers.join('\r\n') + '\r\n\r\n' + body
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new ProviderError(`Google token refresh failed (${res.status})`, res.status)
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) throw new ProviderError('Google did not return an access token', 502)
  return data.access_token
}

export const gmailProvider: EmailProvider = {
  async send(p, creds): Promise<SendResult> {
    if (creds.kind !== 'gmail') throw new ProviderError('Wrong credentials for Gmail provider', 500)
    const accessToken = await refreshAccessToken(creds.refreshToken)
    const raw = Buffer.from(buildMime(p)).toString('base64url')
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after')
      throw new ProviderError(`Gmail send failed (${res.status}): ${(await res.text()).slice(0, 500)}`, res.status,
        retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined)
    }
    const data = await res.json() as { id?: string }
    if (!data.id) throw new ProviderError('Gmail response did not contain a message ID', 502)
    return { providerMessageId: data.id, raw: data }
  },
}
__END__

w lib/providers/resend.ts <<'__END__'
import { ProviderError, type EmailProvider, type SendResult } from './types'
export const resendProvider: EmailProvider = {
  async send(p, creds): Promise<SendResult> {
    if (creds.kind !== 'resend') throw new ProviderError('Wrong credentials for Resend provider', 500)
    const apiKey = creds.apiKey
    if (!apiKey) throw new ProviderError('RESEND_API_KEY not configured', 500)
    const from = p.fromName ? `${p.fromName} <${p.fromEmail}>` : p.fromEmail
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': p.idempotencyKey,
      },
      body: JSON.stringify({
        from, to: p.to, subject: p.subject, html: p.html, text: p.text,
        reply_to: p.replyTo ?? undefined,
        headers: {
          'List-Unsubscribe': `<${p.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after')
      throw new ProviderError(`Resend send failed (${res.status}): ${(await res.text()).slice(0, 500)}`, res.status,
        retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined)
    }
    const data = await res.json() as { id?: string }
    if (!data.id) throw new ProviderError('Resend response did not contain an email ID', 502)
    return { providerMessageId: data.id, raw: data }
  },
}
__END__

w lib/ai/types.ts <<'__END__'
export interface EmailDraftRequest { topic: string; tone: 'professional'|'friendly'|'formal'|'direct'; variables: string[]; sampleValues: Record<string, string> }
export interface EmailDraftResult { subject: string; html: string; text: string }
export interface AIProvider { draft(r: EmailDraftRequest): Promise<EmailDraftResult> }
__END__

w lib/ai/prompt.ts <<'__END__'
import type { EmailDraftRequest } from './types'
export function buildSystemPrompt() {
  return `You write email drafts for MailPilot.
Rules:
- Use ONLY the variables the user provides, in {{variable}} syntax.
- NEVER invent names, dates, codes, prices, URLs, or any factual information.
- If the topic requires a fact that has no matching variable, write [NEEDS_REVIEW: <what is needed>] inline.
- Output strict JSON: {"subject": string, "html": string, "text": string}. No prose outside the JSON.`
}
export function buildUserPrompt(req: EmailDraftRequest): string {
  return `Topic: ${req.topic}\nTone: ${req.tone}\nAllowed variables: ${req.variables.map(v => `{{${v}}}`).join(', ') || '(none)'}\nSample values (tone reference only, do not include as literal): ${JSON.stringify(req.sampleValues)}`
}
__END__

w lib/ai/openai.ts <<'__END__'
import type { AIProvider, EmailDraftRequest, EmailDraftResult } from './types'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
export const openaiProvider: AIProvider = {
  async draft(req: EmailDraftRequest): Promise<EmailDraftResult> {
    const apiKey = process.env.AI_API_KEY
    if (!apiKey) throw new Error('AI_API_KEY not configured')
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: buildUserPrompt(req) }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    })
    if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const parsed = JSON.parse(data.choices[0].message.content)
    return {
      subject: String(parsed.subject ?? '').slice(0, 200),
      html: String(parsed.html ?? ''),
      text: String(parsed.text ?? ''),
    }
  }
}
__END__

w lib/ai/validation.ts <<'__END__'
const CODE_RE = /\b[A-Z]{2,4}\d{3,}\b/g
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/gi
const PRICE_RE = /\$\d[\d,.]*\b|\b\d+\s*(?:USD|EUR|GBP)\b/gi
const URL_RE = /https?:\/\/[^\s)]+/g
export function validateAiDraft(draft: { subject: string; html: string; text: string }, variables: string[]) {
  const text = `${draft.subject}\n${draft.html}\n${draft.text}`
  const warnings: string[] = []
  const check = (re: RegExp, label: string, ok: (v: string) => boolean) => {
    if (variables.some(ok)) return
    const m = text.match(re)
    if (m) warnings.push(`${label}: ${[...new Set(m)].slice(0, 5).join(', ')}`)
  }
  check(CODE_RE, 'Possible invented code', v => v.includes('code'))
  check(DATE_RE, 'Possible invented date', v => v.includes('date'))
  check(PRICE_RE, 'Possible invented price', v => v.includes('price') || v.includes('amount'))
  check(URL_RE, 'Possible invented URL', v => v.includes('url') || v.includes('link'))
  return { valid: warnings.length === 0, warnings }
}
__END__

w lib/ai/index.ts <<'__END__'
import 'server-only'
import type { AIProvider } from './types'
import { openaiProvider } from './openai'
export function getAIProvider(): AIProvider { return openaiProvider }
__END__

w lib/queue/boss.ts <<'__END__'
import PgBoss from 'pg-boss'
let _boss: PgBoss | null = null
export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: 'pgboss', retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300,
  })
  boss.on('error', err => console.error('[pg-boss]', err))
  await boss.start()
  await boss.createQueue('send-email')
  _boss = boss
  return boss
}
__END__

w lib/queue/send-email.ts <<'__END__'
import { getBoss } from './boss'
import { createSupabaseAdmin } from '@/lib/supabase/admin'

export async function enqueueCampaign(campaignId: string) {
  const admin = createSupabaseAdmin()
  const { data: recipients, error: recipientError } = await admin.from('campaign_recipients')
    .select('id, user_id').eq('campaign_id', campaignId).eq('status', 'pending')
  if (recipientError) throw recipientError
  const boss = await getBoss()

  for (const recipient of recipients ?? []) {
    const idempotencyKey = `${recipient.id}:v1`
    let jobId: string | null = null
    const { data: existing, error: lookupError } = await admin.from('sending_jobs')
      .select('id, status').eq('idempotency_key', idempotencyKey).maybeSingle()
    if (lookupError) throw lookupError

    if (existing) {
      if (!['pending', 'deferred'].includes(existing.status)) continue
      jobId = existing.id
    } else {
      const { data: inserted, error: insertError } = await admin.from('sending_jobs')
        .insert({ user_id: recipient.user_id, campaign_recipient_id: recipient.id, idempotency_key: idempotencyKey } as never)
        .select('id').single()
      if (insertError) {
        if (insertError.code !== '23505') throw insertError
        const { data: raced, error: raceError } = await admin.from('sending_jobs')
          .select('id, status').eq('idempotency_key', idempotencyKey).maybeSingle()
        if (raceError) throw raceError
        if (!raced || !['pending', 'deferred'].includes(raced.status)) continue
        jobId = raced.id
      } else {
        jobId = inserted.id
      }
    }
    if (jobId) {
      await boss.send('send-email', { sendingJobId: jobId }, { singletonKey: `${jobId}:initial` })
    }
  }
}
__END__

# ============================================================ MIGRATIONS
w supabase/migrations/0001_initial.sql <<'__END__'
create extension if not exists "uuid-ossp";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null, display_name text, created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.sender_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('gmail','resend')),
  display_name text not null, from_email text not null, from_name text, reply_to text,
  encrypted_refresh_token text, token_iv text, token_tag text, gmail_watch_expires_at timestamptz,
  sender_domain_id uuid,
  status text not null default 'active' check (status in ('active','revoked','error')),
  last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.sender_accounts enable row level security;
create policy "sender_accounts_all_own" on public.sender_accounts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.sender_domains (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  domain text not null, resend_domain_id text not null,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','failed','temporary_failure')),
  dns_records jsonb not null default '[]'::jsonb, verified_at timestamptz, created_at timestamptz not null default now(),
  unique (user_id, domain)
);
alter table public.sender_domains enable row level security;
create policy "sender_domains_all_own" on public.sender_domains for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.contacts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null, name text, company text, custom_fields jsonb not null default '{}'::jsonb,
  consent_source text not null, consented_at timestamptz not null default now(), consent_confirmed boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index contacts_user_email_uniq on public.contacts(user_id, email);
alter table public.contacts enable row level security;
create policy "contacts_all_own" on public.contacts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.contact_lists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null, description text, created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.contact_lists enable row level security;
create policy "contact_lists_all_own" on public.contact_lists for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.contact_list_members (
  contact_list_id uuid not null references public.contact_lists(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(), primary key (contact_list_id, contact_id)
);
alter table public.contact_list_members enable row level security;
create policy "clm_all_own" on public.contact_list_members for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.email_templates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null, subject text not null default '', html_body text not null default '',
  text_body text not null default '', variables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
create policy "email_templates_all_own" on public.email_templates for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sender_account_id uuid references public.sender_accounts(id) on delete restrict,
  name text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','queued','sending','completed','partially_failed','failed','cancelled')),
  subject text not null default '', html_body text not null default '', text_body text not null default '',
  total_recipients int not null default 0, sent_count int not null default 0, failed_count int not null default 0,
  approved_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
create policy "campaigns_all_own" on public.campaigns for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.campaign_recipients (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  rendered_subject text not null, rendered_html text not null, rendered_text text not null,
  status text not null default 'pending' check (status in ('pending','processing','accepted_by_provider','delivered','bounced','failed','suppressed','cancelled')),
  provider_message_id text, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
alter table public.campaign_recipients enable row level security;
create policy "campaign_recipients_all_own" on public.campaign_recipients for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.sending_jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','sent','deferred','failed','suppressed','cancelled')),
  attempts int not null default 0, max_attempts int not null default 5,
  scheduled_at timestamptz not null default now(), last_error text, provider_response jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.sending_jobs enable row level security;
create policy "sending_jobs_select_own" on public.sending_jobs for select to authenticated using ((select auth.uid()) = user_id);

create table public.sending_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sending_job_id uuid not null references public.sending_jobs(id) on delete cascade,
  event_type text not null check (event_type in ('accepted_by_provider','delivered','bounced','complained','failed')),
  provider_event_id text, provider_payload jsonb, occurred_at timestamptz not null default now(),
  unique (sending_job_id, event_type, provider_event_id)
);
alter table public.sending_events enable row level security;
create policy "sending_events_select_own" on public.sending_events for select to authenticated using ((select auth.uid()) = user_id);

create table public.suppressions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null, reason text not null check (reason in ('unsubscribe','bounce','complaint','manual')),
  created_at timestamptz not null default now(), unique (user_id, email)
);
alter table public.suppressions enable row level security;
create policy "suppressions_all_own" on public.suppressions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.consent_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source text not null, evidence jsonb not null default '{}'::jsonb, consented_at timestamptz not null default now()
);
alter table public.consent_events enable row level security;
create policy "consent_events_select_own" on public.consent_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "consent_events_insert_own" on public.consent_events for insert to authenticated with check ((select auth.uid()) = user_id);

create table public.usage_counters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null, emails_sent int not null default 0, ai_drafts int not null default 0,
  primary key (user_id, period_start)
);
alter table public.usage_counters enable row level security;
create policy "usage_counters_select_own" on public.usage_counters for select to authenticated using ((select auth.uid()) = user_id);

create table public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null, entity_type text, entity_id uuid, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "audit_logs_select_own" on public.audit_logs for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.record_audit(p_user_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (p_user_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end; $$;

create or replace function public.increment_usage(p_user_id uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.usage_counters (user_id, period_start, emails_sent) values (p_user_id, p_date, 1)
  on conflict (user_id, period_start) do update set emails_sent = usage_counters.emails_sent + 1;
end; $$;

create or replace function public.check_usage_quota(p_user_id uuid, p_daily_limit int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v int;
begin
  select coalesce(emails_sent, 0) into v from public.usage_counters where user_id = p_user_id and period_start = current_date;
  return jsonb_build_object('allowed', coalesce(v, 0) < p_daily_limit, 'used', coalesce(v, 0), 'limit', p_daily_limit);
end; $$;
__END__

w supabase/migrations/0002_safety_and_delivery.sql <<'__END__'
-- MailPilot hardening migration. Safe to run after 0001_initial.sql.
-- Existing contacts default to NOT eligible until their opt-in is explicitly reconfirmed.
alter table public.contacts add column if not exists consent_confirmed boolean not null default false;
alter table public.sending_jobs add column if not exists locked_at timestamptz;
alter table public.sending_jobs add column if not exists provider_handoff_started_at timestamptz;

alter table public.campaign_recipients drop constraint if exists campaign_recipients_status_check;
alter table public.campaign_recipients add constraint campaign_recipients_status_check
  check (status in ('pending','processing','accepted_by_provider','delivered','bounced','failed','suppressed','cancelled'));

create index if not exists contacts_user_consent_idx on public.contacts(user_id, consent_confirmed);
create index if not exists campaign_recipients_campaign_status_idx on public.campaign_recipients(campaign_id, status);
create index if not exists sending_jobs_status_scheduled_idx on public.sending_jobs(status, scheduled_at);
create index if not exists sending_jobs_locked_at_idx on public.sending_jobs(locked_at) where status = 'processing';

-- Keep dashboard counts consistent regardless of whether status changes come from the worker or webhooks.
create or replace function public.refresh_campaign_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare target_campaign uuid;
begin
  if TG_OP = 'DELETE' then target_campaign := old.campaign_id; else target_campaign := new.campaign_id; end if;
  update public.campaigns c
  set sent_count = (select count(*)::int from public.campaign_recipients r
                    where r.campaign_id = target_campaign and r.status in ('accepted_by_provider','delivered')),
      failed_count = (select count(*)::int from public.campaign_recipients r
                      where r.campaign_id = target_campaign and r.status in ('bounced','failed')),
      status = case
        when c.status = 'cancelled' then 'cancelled'
        when not exists (select 1 from public.campaign_recipients r where r.campaign_id = target_campaign
                         and r.status not in ('accepted_by_provider','delivered','bounced','failed','suppressed','cancelled'))
          then case when exists (select 1 from public.campaign_recipients r where r.campaign_id = target_campaign and r.status in ('bounced','failed'))
                    then 'partially_failed' else 'completed' end
        else c.status
      end,
      completed_at = case
        when not exists (select 1 from public.campaign_recipients r where r.campaign_id = target_campaign
                         and r.status not in ('accepted_by_provider','delivered','bounced','failed','suppressed','cancelled'))
          then coalesce(c.completed_at, now())
        else c.completed_at
      end,
      updated_at = now()
  where c.id = target_campaign;
  if TG_OP = 'DELETE' then return old; else return new; end if;
end; $$;

drop trigger if exists campaign_recipient_count_trigger on public.campaign_recipients;
create trigger campaign_recipient_count_trigger
after insert or update of status or delete on public.campaign_recipients
for each row execute function public.refresh_campaign_counts();

-- Prevent authenticated users from inserting consent records for another account.
drop policy if exists "consent_events_insert_own" on public.consent_events;
create policy "consent_events_insert_own" on public.consent_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Restrict security-definer functions. Audit writes must belong to the signed-in user;
-- quota accounting and queue claims are worker-only service-role operations.
create or replace function public.record_audit(p_user_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'not authorized to write this audit record';
  end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (p_user_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end; $$;
revoke all on function public.record_audit(uuid,text,text,uuid,jsonb) from public, anon;
grant execute on function public.record_audit(uuid,text,text,uuid,jsonb) to authenticated, service_role;
revoke all on function public.increment_usage(uuid,date) from public, anon, authenticated;
grant execute on function public.increment_usage(uuid,date) to service_role;
revoke all on function public.check_usage_quota(uuid,int) from public, anon, authenticated;
grant execute on function public.check_usage_quota(uuid,int) to service_role;

-- Reserve one daily sending slot atomically. This intentionally counts provider attempts,
-- so concurrent workers cannot exceed the configured sending ceiling.
create or replace function public.reserve_usage_slot(p_user_id uuid, p_date date, p_daily_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare reserved_count int;
begin
  insert into public.usage_counters (user_id, period_start, emails_sent)
  values (p_user_id, p_date, 1)
  on conflict (user_id, period_start) do update
    set emails_sent = public.usage_counters.emails_sent + 1
    where public.usage_counters.emails_sent < p_daily_limit
  returning emails_sent into reserved_count;
  return found;
end; $$;
revoke all on function public.reserve_usage_slot(uuid,date,int) from public, anon, authenticated;
grant execute on function public.reserve_usage_slot(uuid,date,int) to service_role;

-- Service-role worker claims pending/deferred jobs and reclaims jobs whose worker lease expired.
create or replace function public.claim_sending_job(p_job_id uuid)
returns setof public.sending_jobs
language sql security definer set search_path = public as $$
  update public.sending_jobs
  set status = 'processing', locked_at = now(), updated_at = now()
  where id = p_job_id and attempts < max_attempts
    and (status in ('pending','deferred') or
         (status = 'processing' and locked_at < now() - interval '2 minutes' and provider_handoff_started_at is null))
  returning *;
$$;
revoke all on function public.claim_sending_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_sending_job(uuid) to service_role;

-- Serialize the send hand-off boundary against cancellation by locking the campaign row.
create or replace function public.begin_provider_handoff(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_campaign_status text;
begin
  select c.status into current_campaign_status
  from public.sending_jobs j
  join public.campaign_recipients r on r.id = j.campaign_recipient_id
  join public.campaigns c on c.id = r.campaign_id
  where j.id = p_job_id and j.status = 'processing'
  for update of c;
  if current_campaign_status is null or current_campaign_status not in ('queued','sending') then
    return false;
  end if;
  update public.sending_jobs
  set provider_handoff_started_at = now(), updated_at = now()
  where id = p_job_id and status = 'processing';
  return found;
end; $$;
revoke all on function public.begin_provider_handoff(uuid) from public, anon, authenticated;
grant execute on function public.begin_provider_handoff(uuid) to service_role;

-- Update job and recipient terminal states in one transaction, avoiding half-completed jobs.
create or replace function public.settle_sending_job(p_job_id uuid, p_status text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare target_recipient uuid;
begin
  if p_status not in ('failed','suppressed','cancelled') then
    raise exception 'invalid terminal sending status';
  end if;
  select campaign_recipient_id into target_recipient
  from public.sending_jobs where id = p_job_id for update;
  if not found then return; end if;
  update public.sending_jobs
  set status = p_status, locked_at = null, last_error = left(p_message, 1000), updated_at = now()
  where id = p_job_id;
  update public.campaign_recipients
  set status = p_status, last_error = left(p_message, 1000), updated_at = now()
  where id = target_recipient;
end; $$;
revoke all on function public.settle_sending_job(uuid,text,text) from public, anon, authenticated;
grant execute on function public.settle_sending_job(uuid,text,text) to service_role;

-- Persist provider acceptance, recipient state and activity event atomically.
create or replace function public.record_provider_accepted(p_job_id uuid, p_message_id text, p_response jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare target_recipient uuid; target_user uuid;
begin
  select campaign_recipient_id, user_id into target_recipient, target_user
  from public.sending_jobs
  where id = p_job_id and status = 'processing' and provider_handoff_started_at is not null
  for update;
  if not found then raise exception 'sending job is not awaiting provider acceptance'; end if;
  update public.sending_jobs
  set status = 'sent', locked_at = null, provider_response = p_response, last_error = null, updated_at = now()
  where id = p_job_id;
  update public.campaign_recipients
  set status = 'accepted_by_provider', provider_message_id = p_message_id, last_error = null, updated_at = now()
  where id = target_recipient;
  insert into public.sending_events (user_id, sending_job_id, event_type, provider_event_id, provider_payload)
  values (target_user, p_job_id, 'accepted_by_provider', p_message_id, coalesce(p_response, '{}'::jsonb))
  on conflict (sending_job_id, event_type, provider_event_id) do nothing;
end; $$;
revoke all on function public.record_provider_accepted(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_accepted(uuid,text,jsonb) to service_role;
__END__

w supabase/seed.sql <<'__END__'
-- Test fixtures for pgTAP. Do not run against production.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'usera@test.local'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'userb@test.local')
on conflict do nothing;
__END__

w supabase/tests/contacts.test.sql <<'__END__'
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
insert into public.contacts (user_id, email, consent_source) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com', 'test');
select results_eq($$ select count(*) from public.contacts $$, array[1::bigint], 'A sees own');
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select results_eq($$ select count(*) from public.contacts $$, array[0::bigint], 'B cannot see A');
select throws_ok(
  $$ insert into public.contacts (user_id, email, consent_source)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','evil@x.com','t') $$,
  '42501', null, 'B cannot insert for A');
select results_eq(
  $$ update public.contacts set email='x@x.com'
     where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id $$,
  array[]::uuid[], 'B cannot update A');
select results_eq(
  $$ delete from public.contacts
     where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id $$,
  array[]::uuid[], 'B cannot delete A');
set local role anon;
set local request.jwt.claim.sub = '';
select results_eq($$ select count(*) from public.contacts $$, array[0::bigint], 'anon sees 0');
select * from finish();
rollback;
__END__

# ============================================================ APP ROOT
w app/globals.css <<'__END__'
@tailwind base;
@tailwind components;
@tailwind utilities;
@layer base {
  :root { --background:0 0% 100%; --foreground:222 47% 11%; --card:0 0% 100%; --card-foreground:222 47% 11%;
    --primary:221 83% 53%; --primary-foreground:210 40% 98%; --muted:210 40% 96%;
    --muted-foreground:215 16% 47%; --border:214 32% 91%; --radius:0.75rem; }
  .dark { --background:222 47% 6%; --foreground:210 40% 98%; --card:222 47% 9%; --card-foreground:210 40% 98%;
    --primary:217 91% 60%; --primary-foreground:222 47% 11%; --muted:217 33% 17%;
    --muted-foreground:215 20% 65%; --border:217 33% 17%; }
  * { @apply border-border; }
  body { @apply bg-background text-foreground antialiased; }
}
__END__

w components/ui/button.tsx <<'__END__'
import * as React from 'react'
import { cn } from '@/lib/utils'
type Variant = 'default' | 'outline' | 'ghost'
type Size = 'default' | 'sm' | 'lg' | 'icon'
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', type = 'button', ...props }, ref
) {
  const variants: Record<Variant, string> = {
    default: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border bg-background hover:bg-muted',
    ghost: 'hover:bg-muted',
  }
  const sizes: Record<Size, string> = {
    default: 'h-10 px-4 py-2', sm: 'h-8 rounded-md px-3 text-xs',
    lg: 'h-11 rounded-md px-8', icon: 'h-9 w-9',
  }
  return <button ref={ref} type={type} className={cn('inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50', variants[variant], sizes[size], className)} {...props} />
})
__END__

w components/ui/input.tsx <<'__END__'
import * as React from 'react'
import { cn } from '@/lib/utils'
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, type, ...props }, ref) {
  return <input ref={ref} type={type} className={cn('flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />
})
__END__

w components/ui/label.tsx <<'__END__'
import * as React from 'react'
import { cn } from '@/lib/utils'
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(function Label({ className, ...props }, ref) {
  return <label ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
})
__END__

w components/theme-provider.tsx <<'__END__'
'use client'
import { ThemeProvider as T } from 'next-themes'
export function ThemeProvider(p: React.ComponentProps<typeof T>) { return <T {...p} /> }
__END__

w components/theme-toggle.tsx <<'__END__'
'use client'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}
__END__

w app/layout.tsx <<'__END__'
import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'
export const metadata: Metadata = { title: 'MailPilot', description: 'Personalized email automation' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>{children}</ThemeProvider>
      </body>
    </html>
  )
}
__END__

w app/page.tsx <<'__END__'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { Mail, Sparkles } from 'lucide-react'
export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold"><Mail className="h-5 w-5"/>MailPilot</Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
            <Link href="/signup"><Button size="sm">Start Sending Smarter</Button></Link>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3"/>Personalized email at scale
        </div>
        <h1 className="text-5xl font-semibold tracking-tight md:text-6xl">Send every recipient an email that feels hand-written.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect your own sender, import authorized recipients, personalize with variables, and track delivery.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup"><Button size="lg">Start Sending Smarter</Button></Link>
          <Link href="#features"><Button size="lg" variant="outline">Explore Features</Button></Link>
        </div>
      </section>
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="mb-12 text-center text-3xl font-semibold">Built for serious senders</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[['Personalization','Auto-render per recipient. Missing variables block sending.'],
            ['AI drafting','Drafts only. Never invents facts. Requires approval.'],
            ['Multi-tenant','Row-level security on every table.']].map(([t,d]) =>
            <div key={t} className="rounded-xl border p-6">
              <div className="mb-2 font-medium">{t}</div>
              <p className="text-sm text-muted-foreground">{d}</p>
            </div>)}
        </div>
      </section>
    </div>
  )
}
__END__

# ============================================================ AUTH
w 'app/(auth)/actions.ts' <<'__END__'
'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
export type AuthState = { error?: string; message?: string }
const email = z.string().email(), password = z.string().min(8)
export async function signupAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const e = email.safeParse(fd.get('email')), p = password.safeParse(fd.get('password'))
  if (!e.success || !p.success) return { error: 'Invalid email or password (min 8 chars)' }
  const s = await createSupabaseServer()
  const { error } = await s.auth.signUp({ email: e.data, password: p.data,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` } })
  if (error) return { error: error.message }
  return { message: 'Check your email to verify your account.' }
}
export async function loginAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const e = email.safeParse(fd.get('email')), p = z.string().min(1).safeParse(fd.get('password'))
  if (!e.success || !p.success) return { error: 'Invalid credentials' }
  const s = await createSupabaseServer()
  const { error } = await s.auth.signInWithPassword({ email: e.data, password: p.data })
  if (error) return { error: 'Invalid email or password' }
  const next = String(fd.get('next') ?? '/dashboard')
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
  redirect(safeNext)
}
export async function logoutAction() { const s = await createSupabaseServer(); await s.auth.signOut(); redirect('/login') }
export async function forgotPasswordAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const e = email.safeParse(fd.get('email')); if (!e.success) return { error: 'Invalid email' }
  const s = await createSupabaseServer()
  await s.auth.resetPasswordForEmail(e.data, { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=%2Freset-password` })
  return { message: 'If that email exists, a reset link was sent.' }
}
__END__

w 'app/(auth)/login/page.tsx' <<'__END__'
'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction, type AuthState } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
const initial: AuthState = {}
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial)
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-2xl font-semibold">MailPilot</Link>
      <h1 className="mb-2 text-2xl font-semibold">Welcome back</h1>
      <form action={formAction} className="mt-6 space-y-4">
        <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
        <div><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required /></div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <div className="mt-6 flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">Forgot password?</Link>
        <Link href="/signup" className="hover:underline">Create account</Link>
      </div>
    </div>
  )
}
__END__

w 'app/(auth)/signup/page.tsx' <<'__END__'
'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { signupAction, type AuthState } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
const initial: AuthState = {}
export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, initial)
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-2xl font-semibold">MailPilot</Link>
      <h1 className="mb-2 text-2xl font-semibold">Create your account</h1>
      <form action={formAction} className="mt-6 space-y-4">
        <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
        <div><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Creating…' : 'Create account'}</Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">Have an account? <Link href="/login" className="hover:underline">Sign in</Link></p>
    </div>
  )
}
__END__

w 'app/(auth)/forgot-password/page.tsx' <<'__END__'
'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { forgotPasswordAction, type AuthState } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
const initial: AuthState = {}
export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initial)
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-2xl font-semibold">MailPilot</Link>
      <h1 className="mb-2 text-2xl font-semibold">Reset your password</h1>
      <form action={formAction} className="mt-6 space-y-4">
        <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground"><Link href="/login" className="hover:underline">Back</Link></p>
    </div>
  )
}
__END__

w 'app/(auth)/reset-password/page.tsx' <<'__END__'
'use client'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setPending(true)
    const { error: updateError } = await createSupabaseBrowser().auth.updateUser({ password })
    setPending(false)
    if (updateError) { setError('The reset link may have expired. Request a new one and try again.'); return }
    router.replace('/login?password_updated=1')
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-2xl font-semibold">MailPilot</Link>
      <h1 className="mb-2 text-2xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div><Label htmlFor="password">New password</Label><Input id="password" type="password" minLength={8} autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} /></div>
        <div><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" minLength={8} autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</Button>
      </form>
    </div>
  )
}
__END__

w app/auth/callback/route.ts <<'__END__'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
  if (code) {
    const supabase = await createSupabaseServer()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(safeNext, origin))
  }
  return NextResponse.redirect(new URL('/login?error=callback_failed', origin))
}
__END__

# ============================================================ DASHBOARD
w config/navigation.ts <<'__END__'
import { Activity, FileText, LayoutDashboard, Mail, PenLine, Send, Settings, Users } from 'lucide-react'
export const dashboardNav = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Compose', href: '/dashboard/compose', icon: PenLine },
  { label: 'Campaigns', href: '/dashboard/campaigns', icon: Send },
  { label: 'Contacts', href: '/dashboard/contacts', icon: Users },
  { label: 'Senders', href: '/dashboard/senders', icon: Mail },
  { label: 'Templates', href: '/dashboard/templates', icon: FileText },
  { label: 'Activity', href: '/dashboard/activity', icon: Activity },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
] as const
__END__

w components/app-sidebar.tsx <<'__END__'
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { dashboardNav } from '@/config/navigation'
import { cn } from '@/lib/utils'
export function AppSidebar() {
  const p = usePathname()
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/20 md:block">
      <div className="p-6 text-lg font-semibold">MailPilot</div>
      <nav className="space-y-1 px-3">
        {dashboardNav.map(({ label, href, icon: Icon }) => {
          const active = p === href || (href !== '/dashboard' && p.startsWith(href))
          return (
            <Link key={href} href={href} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
              active ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/60')}>
              <Icon className="h-4 w-4" />{label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
__END__

w app/dashboard/layout.tsx <<'__END__'
import { requireUser, isAdmin } from '@/lib/auth/require-user'
import { AppSidebar } from '@/components/app-sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { logoutAction } from '../(auth)/actions'
export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser()
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <div className="text-sm text-muted-foreground">{user.email}</div>
          <div className="flex items-center gap-2">
            {isAdmin(user) && <Link href="/admin"><Button variant="outline" size="sm">Admin</Button></Link>}
            <ThemeToggle />
            <form action={logoutAction}><Button variant="ghost" size="sm">Sign out</Button></form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
__END__

w app/dashboard/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
export default async function Overview() {
  const { user, supabase } = await requireUser()
  const [{ data: campaigns }, { count: senders }] = await Promise.all([
    supabase.from('campaigns').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('sender_accounts').select('*', { count: 'exact', head: true }),
  ])
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Welcome, {user.email}</p>
      </div>
      {(!senders || senders === 0) && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-medium">Connect a sender to get started</h2>
          <Link href="/dashboard/senders" className="mt-4 inline-block"><Button>Connect sender</Button></Link>
        </div>
      )}
      {(!campaigns || campaigns.length === 0) ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-medium">Create your first campaign</h2>
          <Link href="/dashboard/compose" className="mt-4 inline-block"><Button>Compose email</Button></Link>
        </div>
      ) : (
        <div className="rounded-xl border">
          <div className="border-b p-4 font-medium">Recent campaigns</div>
          <ul className="divide-y">
            {campaigns.map(c => (
              <li key={c.id} className="flex items-center justify-between p-4 text-sm">
                <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                <span className="text-muted-foreground">{c.status}</span>
                <span>{c.sent_count}/{c.total_recipients}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
__END__

w app/dashboard/senders/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
export default async function SendersPage() {
  const { supabase } = await requireUser()
  const { data: senders } = await supabase.from('sender_accounts').select('*')
  const googleOk = !!process.env.GOOGLE_CLIENT_ID && !!process.env.OAUTH_STATE_SECRET
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sender accounts</h1>
        <p className="text-sm text-muted-foreground">Connect Gmail or a verified business domain.</p>
      </div>
      {(senders ?? []).length > 0 && (
        <div className="rounded-xl border">
          <div className="border-b p-4 font-medium">Connected</div>
          <ul className="divide-y">
            {senders!.map(s => (
              <li key={s.id} className="flex items-center justify-between p-4 text-sm">
                <div><div className="font-medium">{s.display_name}</div>
                  <div className="text-muted-foreground">{s.from_email} · {s.provider}</div></div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-6">
          <div className="font-medium">Gmail / Google Workspace</div>
          <p className="mt-2 text-sm text-muted-foreground">OAuth with gmail.send. Refresh tokens encrypted.</p>
          {googleOk ? <Link href="/api/oauth/google/start" className="mt-4 inline-block"><Button>Connect Gmail</Button></Link>
            : <div className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200">
                Google OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_STATE_SECRET, GOOGLE_REDIRECT_URI.</div>}
        </div>
        <div className="rounded-xl border p-6">
          <div className="font-medium">Business email via Resend</div>
          <p className="mt-2 text-sm text-muted-foreground">The Resend delivery adapter is included for administrator-provisioned verified senders.</p>
          <div className="mt-4 rounded-lg border p-3 text-sm text-muted-foreground">Per-user domain verification and sender onboarding are not included yet. Use Gmail OAuth for self-service sender connection.</div>
        </div>
      </div>
    </div>
  )
}
__END__

w app/dashboard/contacts/actions.ts <<'__END__'
'use server'
import Papa from 'papaparse'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/require-user'
import { audit } from '@/lib/security/audit'

const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase())
const sourceSchema = z.string().trim().min(3).max(200)

function requireConsent(fd: FormData) {
  if (fd.get('consent_confirmed') !== 'on') {
    throw new Error('Confirm that every imported recipient explicitly opted in to receive your emails.')
  }
}

export async function addContactAction(fd: FormData) {
  const { user, supabase } = await requireUser()
  requireConsent(fd)
  const email = emailSchema.parse(fd.get('email'))
  const source = sourceSchema.parse(fd.get('consent_source'))
  const name = String(fd.get('name') ?? '').trim().slice(0, 120) || null

  const { data: contact, error } = await supabase.from('contacts').upsert({
    user_id: user.id, email, name, consent_source: source, consent_confirmed: false,
    consented_at: new Date().toISOString(),
  } as never, { onConflict: 'user_id,email' }).select('id').single()
  if (error) throw error

  const { error: consentError } = await supabase.from('consent_events').insert({
    user_id: user.id, contact_id: contact.id, source,
    evidence: { capture_method: 'manual_entry', confirmed_by_account_owner: true },
  } as never)
  if (consentError) throw consentError
  const { error: activateError } = await supabase.from('contacts').update({ consent_confirmed: true, consented_at: new Date().toISOString() } as never).eq('id', contact.id)
  if (activateError) throw activateError
  await audit(user.id, 'contact.added', 'contact', contact.id, { email })
  redirect('/dashboard/contacts?added=1')
}

export async function importContactsAction(fd: FormData) {
  const { user, supabase } = await requireUser()
  requireConsent(fd)
  const source = sourceSchema.parse(fd.get('consent_source'))
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('Choose a CSV file to import.')
  if (file.size > 2 * 1024 * 1024) throw new Error('CSV must be 2 MB or smaller.')
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Upload a .csv file.')

  const csv = await file.text()
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.replace(/^\uFEFF/, '').trim().toLowerCase() })
  if (parsed.errors.length) throw new Error(`CSV parsing failed: ${parsed.errors[0].message}`)
  if (!parsed.meta.fields?.includes('email')) throw new Error('CSV must include an email column. Optional columns: name, company, plus custom fields (for example boarding_code, flight_number).')
  if (parsed.data.length === 0) throw new Error('CSV contains no contacts.')
  if (parsed.data.length > 500) throw new Error('Import up to 500 contacts per CSV.')

  const reservedHeaders = new Set(['email', 'name', 'company'])
  const customHeaders = (parsed.meta.fields ?? []).filter(header => !reservedHeaders.has(header))
  if (customHeaders.some(header => !/^[a-z][a-z0-9_]{0,63}$/.test(header) || ['unsubscribe_url', 'consent_confirmed', 'consent_source'].includes(header))) {
    throw new Error('Custom CSV headers must use simple lowercase names such as boarding_code or flight_number. Reserved fields cannot be overridden.')
  }
  const rows = parsed.data.map((row, index) => ({
    rowNumber: index + 2,
    email: emailSchema.safeParse(row.email ?? ''),
    name: String(row.name ?? '').trim().slice(0, 120) || null,
    company: String(row.company ?? '').trim().slice(0, 120) || null,
    custom_fields: Object.fromEntries(customHeaders.filter(header => String(row[header] ?? '').trim() !== '')
      .map(header => [header, String(row[header]).trim().slice(0, 500)])),
  }))
  const invalid = rows.find(row => !row.email.success)
  if (invalid) throw new Error(`Invalid email in CSV row ${invalid.rowNumber}.`)
  const unique = new Map<string, { email: string; name: string | null; company: string | null; custom_fields: Record<string, string> }>()
  for (const row of rows) {
    if (row.email.success) unique.set(row.email.data, { email: row.email.data, name: row.name, company: row.company, custom_fields: row.custom_fields })
  }
  const contacts = [...unique.values()].map(row => ({
    user_id: user.id, ...row, consent_source: source, consent_confirmed: false,
    consented_at: new Date().toISOString(),
  }))

  const { data: saved, error } = await supabase.from('contacts').upsert(contacts as never, { onConflict: 'user_id,email' }).select('id,email')
  if (error) throw error
  const consentRows = (saved ?? []).map(contact => ({
    user_id: user.id, contact_id: contact.id, source,
    evidence: { capture_method: 'csv_import', filename: file.name, confirmed_by_account_owner: true },
  }))
  if (consentRows.length) {
    const { error: consentError } = await supabase.from('consent_events').insert(consentRows as never)
    if (consentError) throw consentError
    const savedIds = (saved ?? []).map(contact => contact.id)
    if (savedIds.length) {
      const { error: activateError } = await supabase.from('contacts')
        .update({ consent_confirmed: true, consented_at: new Date().toISOString() } as never).in('id', savedIds)
      if (activateError) throw activateError
    }
  }
  await audit(user.id, 'contacts.imported', 'contact', undefined, { count: saved?.length ?? 0, filename: file.name })
  redirect(`/dashboard/contacts?imported=${saved?.length ?? 0}`)
}

export async function deleteContactAction(fd: FormData) {
  const { user, supabase } = await requireUser()
  const id = z.string().uuid().parse(fd.get('id'))
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) throw error
  await audit(user.id, 'contact.deleted', 'contact', id, {})
  redirect('/dashboard/contacts')
}
__END__

w app/dashboard/contacts/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
import { Button } from '@/components/ui/button'
import { addContactAction, deleteContactAction, importContactsAction } from './actions'

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ added?: string; imported?: string }> }) {
  const [{ supabase }, params] = await Promise.all([requireUser(), searchParams])
  const { data: contacts } = await supabase.from('contacts')
    .select('id,email,name,consent_confirmed,created_at').order('created_at', { ascending: false }).limit(500)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Only contacts with recorded opt-in confirmation can be selected for campaigns.</p>
      </div>
      {params.added && <p className="rounded-lg border p-3 text-sm">Contact saved.</p>}
      {params.imported && <p className="rounded-lg border p-3 text-sm">Imported or updated {params.imported} contacts.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <form action={addContactAction} className="space-y-3 rounded-xl border p-6">
          <div className="font-medium">Add one contact</div>
          <input name="email" type="email" required maxLength={254} placeholder="name@example.com" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          <input name="name" maxLength={120} placeholder="Name (optional)" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          <input name="consent_source" required minLength={3} maxLength={200} placeholder="How did they opt in? e.g. registration form" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="consent_confirmed" required className="mt-0.5" />
            I confirm this person explicitly agreed to receive emails from my organization. I will not upload purchased, scraped, or unsolicited lists.
          </label>
          <Button type="submit">Save contact</Button>
        </form>
        <form action={importContactsAction} className="space-y-3 rounded-xl border p-6">
          <div className="font-medium">Import from CSV</div>
          <p className="text-xs text-muted-foreground">Maximum 500 rows and 2 MB. Required column: email. Optional: name, company, plus simple custom columns such as boarding_code or flight_number.</p>
          <input name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm" />
          <input name="consent_source" required minLength={3} maxLength={200} placeholder="Where was opt-in collected?" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="consent_confirmed" required className="mt-0.5" />
            I confirm every row in this CSV represents a person who explicitly opted in to receive these emails.
          </label>
          <Button type="submit" variant="outline">Import contacts</Button>
        </form>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <div className="border-b p-4 font-medium">Your contacts ({contacts?.length ?? 0})</div>
        <ul className="divide-y">
          {(contacts ?? []).map(contact => (
            <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <div className="font-medium">{contact.email}</div>
                <div className="text-muted-foreground">{contact.name ?? 'No name'}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={contact.consent_confirmed ? 'text-emerald-600' : 'text-amber-600'}>
                  {contact.consent_confirmed ? 'Opt-in confirmed' : 'Not eligible to send'}
                </span>
                <form action={deleteContactAction}>
                  <input type="hidden" name="id" value={contact.id} />
                  <Button variant="outline" size="sm" type="submit">Delete</Button>
                </form>
              </div>
            </li>
          ))}
          {(contacts ?? []).length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No contacts yet.</li>}
        </ul>
      </div>
    </div>
  )
}
__END__

w app/dashboard/compose/actions.ts <<'__END__'
'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/require-user'
import { renderSubject, renderHtml, renderText, extractVariables, buildRecipientData } from '@/lib/personalization/render'
import { MissingVariableError } from '@/lib/personalization/errors'
import { buildUnsubscribeUrl, ensureUnsubscribeFooter } from '@/lib/personalization/unsubscribe'
import { audit } from '@/lib/security/audit'
import { campaignCreateLimiter, checkLimit } from '@/lib/security/rate-limit'

const composeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sender_account_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(200),
  html_body: z.string().min(1).max(100_000),
  text_body: z.string().min(1).max(50_000),
})

export async function createCampaignAction(fd: FormData) {
  const { user, supabase } = await requireUser()
  const limit = await checkLimit(campaignCreateLimiter, user.id)
  if (!limit.ok) throw new Error(`Campaign limit reached. Try again in ${limit.retryAfter} seconds.`)

  const parsed = composeSchema.parse({
    name: fd.get('name'), sender_account_id: fd.get('sender_account_id'),
    subject: fd.get('subject'), html_body: fd.get('html_body'), text_body: fd.get('text_body'),
  })
  const contactIds = [...new Set(fd.getAll('contact_ids').map(value => String(value)).filter(Boolean))]
  if (contactIds.length === 0) throw new Error('Select at least one recipient.')
  if (contactIds.length > 500) throw new Error('A campaign can contain at most 500 recipients.')
  if (contactIds.some(id => !z.string().uuid().safeParse(id).success)) throw new Error('Invalid recipient selection.')

  const { data: sender, error: senderError } = await supabase.from('sender_accounts')
    .select('*').eq('id', parsed.sender_account_id).eq('status', 'active').maybeSingle()
  if (senderError) throw senderError
  if (!sender) throw new Error('Select an active sender account that belongs to you.')

  const { data: contacts, error: contactsError } = await supabase.from('contacts')
    .select('*').in('id', contactIds).eq('consent_confirmed', true)
  if (contactsError) throw contactsError
  if (!contacts || contacts.length !== contactIds.length) {
    throw new Error('One or more selected contacts are missing, not opted in, or do not belong to your account.')
  }
  const emails = contacts.map(contact => contact.email.toLowerCase())
  const { data: suppressions, error: suppressionError } = await supabase.from('suppressions')
    .select('email').in('email', emails)
  if (suppressionError) throw suppressionError
  const suppressed = new Set((suppressions ?? []).map(row => row.email.toLowerCase()))
  const blocked = contacts.filter(contact => suppressed.has(contact.email.toLowerCase()))
  if (blocked.length) throw new Error(`${blocked.length} selected contact(s) are suppressed. Remove them before creating the campaign.`)

  const allVars = new Set([
    ...extractVariables(parsed.subject), ...extractVariables(parsed.html_body),
    ...extractVariables(parsed.text_body), 'unsubscribe_url',
  ])
  const rendered: { contactId: string; subject: string; html: string; text: string }[] = []
  for (const contact of contacts) {
    const data = buildRecipientData(contact as never)
    for (const variable of allVars) {
      if (variable !== 'unsubscribe_url' && !(variable in data)) {
        throw new Error(`${contact.email} is missing {{${variable}}}. Add this field or change the template.`)
      }
    }
    const unsubscribeUrl = buildUnsubscribeUrl(contact.id, user.id)
    data.unsubscribe_url = unsubscribeUrl
    try {
      let html = renderHtml(parsed.html_body, data)
      if (!parsed.html_body.includes('{{unsubscribe_url}}')) html = ensureUnsubscribeFooter(html, unsubscribeUrl)
      const renderedText = renderText(parsed.text_body, data)
      rendered.push({
        contactId: contact.id,
        subject: renderSubject(parsed.subject, data),
        html,
        text: renderedText.includes(unsubscribeUrl) ? renderedText : `${renderedText}\n\nUnsubscribe: ${unsubscribeUrl}`,
      })
    } catch (error) {
      if (error instanceof MissingVariableError) throw new Error(`Missing variable: ${error.variable}`)
      throw error
    }
  }

  const { data: campaign, error: campaignError } = await supabase.from('campaigns').insert({
    user_id: user.id, sender_account_id: sender.id, name: parsed.name,
    status: 'awaiting_approval', subject: parsed.subject,
    html_body: parsed.html_body, text_body: parsed.text_body,
    total_recipients: rendered.length,
  } as never).select('id').single()
  if (campaignError || !campaign) throw campaignError ?? new Error('Could not create campaign.')

  const { error: recipientError } = await supabase.from('campaign_recipients').insert(
    rendered.map(row => ({
      campaign_id: campaign.id, user_id: user.id, contact_id: row.contactId,
      rendered_subject: row.subject, rendered_html: row.html, rendered_text: row.text, status: 'pending',
    })) as never
  )
  if (recipientError) {
    await supabase.from('campaigns').delete().eq('id', campaign.id)
    throw recipientError
  }
  await audit(user.id, 'campaign.created', 'campaign', campaign.id, { recipients: rendered.length })
  redirect(`/dashboard/campaigns/${campaign.id}`)
}
__END__

w app/dashboard/compose/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
import { Button } from '@/components/ui/button'
import { createCampaignAction } from './actions'

export default async function ComposePage() {
  const { supabase } = await requireUser()
  const [{ data: senders }, { data: contacts }, { data: suppressions }] = await Promise.all([
    supabase.from('sender_accounts').select('id,display_name,from_email').eq('status', 'active'),
    supabase.from('contacts').select('id,email,name').eq('consent_confirmed', true).order('created_at', { ascending: false }).limit(500),
    supabase.from('suppressions').select('email'),
  ])
  const blocked = new Set((suppressions ?? []).map(row => row.email.toLowerCase()))
  const eligibleContacts = (contacts ?? []).filter(contact => !blocked.has(contact.email.toLowerCase()))
  if (!senders?.length) return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <h1 className="text-lg font-medium">Connect a sender first</h1>
      <a href="/dashboard/senders" className="mt-4 inline-block"><Button>Go to senders</Button></a>
    </div>
  )
  if (!eligibleContacts.length) return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <h1 className="text-lg font-medium">No eligible recipients yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">Add contacts with explicit opt-in confirmation and remove suppressed addresses.</p>
      <a href="/dashboard/contacts" className="mt-4 inline-block"><Button>Add contacts</Button></a>
    </div>
  )
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Compose campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose recipients explicitly. Every campaign requires a separate approval before queueing.</p>
      </div>
      <form action={createCampaignAction} className="space-y-4 rounded-xl border p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">Campaign name
            <input name="name" required maxLength={120} className="mt-1 w-full rounded-lg border bg-background px-3 py-2" />
          </label>
          <label className="text-sm">Sender
            <select name="sender_account_id" required className="mt-1 w-full rounded-lg border bg-background px-3 py-2">
              {senders.map(sender => <option key={sender.id} value={sender.id}>{sender.display_name} — {sender.from_email}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="space-y-2 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Recipients ({eligibleContacts.length} eligible)</legend>
          <p className="text-xs text-muted-foreground">Select only people who agreed to receive this type of email. Suppressed contacts are excluded.</p>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {eligibleContacts.map(contact => (
              <label key={contact.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="contact_ids" value={contact.id} />
                <span>{contact.email}</span>
                {contact.name && <span className="text-muted-foreground">— {contact.name}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">Subject
          <input name="subject" required maxLength={200} className="mt-1 w-full rounded-lg border bg-background px-3 py-2" placeholder="Your boarding confirmation - {{name}}" />
        </label>
        <label className="block text-sm">HTML body
          <textarea name="html_body" required rows={10} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs"
            placeholder={'<p>Hello {{name}},</p><p>Your boarding code is {{boarding_code}}.</p>'} />
        </label>
        <label className="block text-sm">Plain text body
          <textarea name="text_body" required rows={6} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs"
            placeholder={'Hello {{name}},\nYour boarding code is {{boarding_code}}.'} />
        </label>
        <Button type="submit">Create draft for approval</Button>
        <p className="text-xs text-muted-foreground">Unsubscribe footer and one-click unsubscribe headers are added automatically. Missing variables and suppressed recipients block campaign creation.</p>
      </form>
    </div>
  )
}
__END__

w app/dashboard/campaigns/actions.ts <<'__END__'
'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/require-user'
import { audit } from '@/lib/security/audit'
import { enqueueCampaign } from '@/lib/queue/send-email'

const campaignIdSchema = z.string().uuid()

export async function approveFormAction(fd: FormData) {
  const campaignId = campaignIdSchema.parse(fd.get('campaign_id'))
  const { user, supabase } = await requireUser()
  const { data: updated, error } = await supabase.from('campaigns')
    .update({ status: 'queued', approved_at: new Date().toISOString() } as never)
    .eq('id', campaignId).eq('status', 'awaiting_approval').select('id').maybeSingle()
  if (error) throw error
  if (!updated) throw new Error('Campaign is no longer awaiting approval. Refresh the page.')
  try {
    await enqueueCampaign(campaignId)
  } catch (error) {
    // Keep the campaign queued; enqueueCampaign is idempotent and can safely be run again by an operator.
    await audit(user.id, 'campaign.enqueue_failed', 'campaign', campaignId, { message: error instanceof Error ? error.message : 'Unknown error' })
    throw new Error('Campaign approved but queueing failed. Do not approve again; check worker/database configuration and retry queueing.')
  }
  await audit(user.id, 'campaign.approved', 'campaign', campaignId, {})
  redirect(`/dashboard/campaigns/${campaignId}`)
}

export async function retryQueueAction(fd: FormData) {
  const campaignId = campaignIdSchema.parse(fd.get('campaign_id'))
  const { user, supabase } = await requireUser()
  const { data: campaign, error } = await supabase.from('campaigns')
    .select('id,status').eq('id', campaignId).maybeSingle()
  if (error) throw error
  if (!campaign || campaign.status !== 'queued') throw new Error('Only queued campaigns can be re-queued.')
  await enqueueCampaign(campaignId)
  await audit(user.id, 'campaign.queue_retried', 'campaign', campaignId, {})
  redirect(`/dashboard/campaigns/${campaignId}`)
}

export async function cancelFormAction(fd: FormData) {
  const campaignId = campaignIdSchema.parse(fd.get('campaign_id'))
  const { user, supabase } = await requireUser()
  const { data: cancelled, error } = await supabase.from('campaigns')
    .update({ status: 'cancelled' } as never)
    .eq('id', campaignId).in('status', ['draft', 'awaiting_approval', 'queued', 'sending'])
    .select('id').maybeSingle()
  if (error) throw error
  if (!cancelled) throw new Error('Campaign could not be cancelled. It may already be complete.')
  const { data: campaignRecipients, error: listError } = await supabase.from('campaign_recipients')
    .select('id').eq('campaign_id', campaignId)
  if (listError) throw listError
  const recipientIds = (campaignRecipients ?? []).map(row => row.id)
  if (recipientIds.length) {
    const { error: recipientsError } = await supabase.from('campaign_recipients')
      .update({ status: 'cancelled' } as never).eq('campaign_id', campaignId).eq('status', 'pending')
    if (recipientsError) throw recipientsError
    const { error: jobsError } = await supabase.from('sending_jobs')
      .update({ status: 'cancelled', locked_at: null } as never)
      .eq('user_id', user.id).in('status', ['pending', 'deferred']).in('campaign_recipient_id', recipientIds)
    if (jobsError) throw jobsError
  }
  await audit(user.id, 'campaign.cancelled', 'campaign', campaignId, { note: 'In-flight provider requests may still finish.' })
  redirect(`/dashboard/campaigns/${campaignId}`)
}
__END__

w app/dashboard/campaigns/page.tsx <<'__END__'
import Link from 'next/link'
import { requireUser } from '@/lib/auth/require-user'
export default async function CampaignsPage() {
  const { supabase } = await requireUser()
  const { data: campaigns } = await supabase.from('campaigns')
    .select('*').order('created_at', { ascending: false }).limit(100)
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <div className="rounded-xl border">
        <ul className="divide-y">
          {(campaigns ?? []).map(c => (
            <li key={c.id} className="flex items-center justify-between p-4 text-sm">
              <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
              <span className="text-muted-foreground">{c.status}</span>
              <span>{c.sent_count}/{c.total_recipients}</span>
            </li>
          ))}
          {(campaigns ?? []).length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No campaigns yet.</li>}
        </ul>
      </div>
    </div>
  )
}
__END__

w 'app/dashboard/campaigns/[id]/page.tsx' <<'__END__'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/require-user'
import { Button } from '@/components/ui/button'
import { approveFormAction, cancelFormAction, retryQueueAction } from '../actions'
export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireUser()
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle()
  if (!campaign) notFound()
  const { data: recipients } = await supabase.from('campaign_recipients').select('status').eq('campaign_id', id)
  const counts = (recipients ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {})
  const canApprove = campaign.status === 'awaiting_approval'
  const canCancel = ['draft', 'awaiting_approval', 'queued', 'sending'].includes(campaign.status)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">{campaign.name}</h1><p className="text-sm text-muted-foreground">{campaign.subject}</p></div>
        <div className="flex gap-2">
          {canApprove && <form action={approveFormAction}><input type="hidden" name="campaign_id" value={campaign.id} /><Button type="submit">Approve &amp; send</Button></form>}
          {campaign.status === 'queued' && <form action={retryQueueAction}><input type="hidden" name="campaign_id" value={campaign.id} /><Button type="submit" variant="outline">Retry queueing</Button></form>}
          {canCancel && <form action={cancelFormAction}><input type="hidden" name="campaign_id" value={campaign.id} /><Button type="submit" variant="outline">Stop campaign</Button></form>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['pending', 'processing', 'accepted_by_provider', 'delivered', 'bounced', 'failed', 'suppressed', 'cancelled'].map(key => (
          <div key={key} className="rounded-xl border p-4"><div className="text-xs uppercase text-muted-foreground">{key.replace(/_/g, ' ')}</div><div className="mt-1 text-2xl font-semibold">{counts[key] ?? 0}</div></div>
        ))}
      </div>
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        Status: <span className="font-medium text-foreground">{campaign.status}</span>
        <p className="mt-2">Provider acceptance is not the same as inbox delivery. Delivery and bounce events update when the provider webhook is configured.</p>
        {campaign.status === 'cancelled' && <p className="mt-2">Cancellation stops jobs not yet handed to the email provider. A request already in flight may still complete.</p>}
      </div>
    </div>
  )
}
__END__

w app/dashboard/templates/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
export default async function TemplatesPage() {
  const { supabase } = await requireUser()
  const { data } = await supabase.from('email_templates').select('*')
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Templates</h1>
      <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
        {(data ?? []).length === 0 ? 'No templates yet.' : `${data!.length} templates`}
      </div>
    </div>
  )
}
__END__

w app/dashboard/activity/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
export default async function ActivityPage() {
  const { supabase } = await requireUser()
  const { data: events } = await supabase.from('sending_events')
    .select('*').order('occurred_at', { ascending: false }).limit(200)
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Email activity</h1>
      <div className="rounded-xl border">
        <ul className="divide-y">
          {(events ?? []).map(e => (
            <li key={e.id} className="flex items-center justify-between p-4 text-sm">
              <span className="font-medium">{e.event_type}</span>
              <span className="text-muted-foreground">{new Date(e.occurred_at).toLocaleString()}</span>
            </li>
          ))}
          {(events ?? []).length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No activity yet.</li>}
        </ul>
      </div>
    </div>
  )
}
__END__

w app/dashboard/settings/page.tsx <<'__END__'
import { requireUser } from '@/lib/auth/require-user'
export default async function SettingsPage() {
  const { user } = await requireUser()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="rounded-xl border p-6 space-y-3 text-sm">
        <div><span className="text-muted-foreground">Email:</span> {user.email}</div>
        <div><span className="text-muted-foreground">User ID:</span> {user.id}</div>
      </div>
    </div>
  )
}
__END__

w app/admin/page.tsx <<'__END__'
import { requireUser, isAdmin } from '@/lib/auth/require-user'
import { notFound } from 'next/navigation'
export default async function AdminPage() {
  const { user } = await requireUser()
  if (!isAdmin(user)) notFound()
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-2 text-sm text-muted-foreground">Add admin tools here.</p>
    </div>
  )
}
__END__

w app/unsubscribe/route.ts <<'__END__'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type UnsubscribePayload = { contactId: string; userId: string; exp: number }
function verify(token: string): UnsubscribePayload | null {
  const secret = process.env.UNSUBSCRIBE_JWT_SECRET
  if (!secret) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, signature] = parts
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  try {
    const actualBytes = Buffer.from(signature, 'base64url')
    const expectedBytes = Buffer.from(expected, 'base64url')
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UnsubscribePayload
    if (!payload.contactId || !payload.userId || !Number.isFinite(payload.exp) || Date.now() > payload.exp) return null
    return payload
  } catch { return null }
}

function confirmationPage(token: string) {
  const safeToken = encodeURIComponent(token)
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm unsubscribe</title><body style="font-family:system-ui;max-width:36rem;margin:10vh auto;padding:2rem;color:#111827"><h1>Confirm unsubscribe</h1><p>Press the button below to stop receiving emails from this sender.</p><form method="POST" action="/unsubscribe?token=${safeToken}"><button style="padding:.75rem 1.25rem;border:0;border-radius:.5rem;background:#111827;color:white;font-size:1rem" type="submit">Unsubscribe</button></form></body></html>`
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  if (!verify(token)) return new NextResponse('Invalid or expired unsubscribe link.', { status: 400 })
  return new NextResponse(confirmationPage(token), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  const payload = verify(token)
  if (!payload) return new NextResponse('Invalid or expired unsubscribe link.', { status: 400 })

  // RFC 8058 one-click requests are POSTs carrying this exact field. A form POST from
  // the confirmation page is also accepted; GET requests never change subscription state.
  const body = await request.text().catch(() => '')
  const params = new URLSearchParams(body)
  const isOneClick = params.get('List-Unsubscribe') === 'One-Click'
  const isConfirmation = request.headers.get('content-type')?.includes('application/x-www-form-urlencoded') && params.has('') === false
  if (!isOneClick && !isConfirmation) return new NextResponse('Invalid unsubscribe request.', { status: 400 })

  const admin = createSupabaseAdmin()
  const { data: contact, error: lookupError } = await admin.from('contacts')
    .select('id,email,user_id').eq('id', payload.contactId).maybeSingle()
  if (lookupError || !contact || contact.user_id !== payload.userId) {
    return new NextResponse('Invalid unsubscribe link.', { status: 400 })
  }
  const { error } = await admin.from('suppressions').upsert({
    user_id: contact.user_id, email: contact.email.toLowerCase(), reason: 'unsubscribe',
  } as never, { onConflict: 'user_id,email' })
  if (error) return new NextResponse('Unable to process your request. Please try again.', { status: 500 })
  await admin.from('contacts').update({ consent_confirmed: false } as never).eq('id', contact.id)
  return new NextResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Unsubscribed</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>You are unsubscribed</h1><p>You will no longer receive emails from this sender.</p></body></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
__END__

# ============================================================ API
w app/api/oauth/google/start/route.ts <<'__END__'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { makeOAuthState } from '@/lib/security/oauth-state'
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.OAUTH_STATE_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    return NextResponse.redirect(new URL('/dashboard/senders?error=google_not_configured', request.url))
  }
  const state = makeOAuthState(user.id)
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/gmail.send')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  const response = NextResponse.redirect(url.toString())
  response.cookies.set('mailpilot_google_oauth_state', state, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/api/oauth/google/callback', maxAge: 600,
  })
  return response
}
__END__

w app/api/oauth/google/callback/route.ts <<'__END__'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto/token-vault'
import { verifyOAuthState } from '@/lib/security/oauth-state'
import { audit } from '@/lib/security/audit'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const cookieState = request.cookies.get('mailpilot_google_oauth_state')?.value
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard/senders?error=${reason}`, request.url))
    response.cookies.delete('mailpilot_google_oauth_state')
    return response
  }
  if (!code || !state || !cookieState || state !== cookieState) return fail('invalid_oauth_state')

  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail('login_required')
  if (!verifyOAuthState(state, user.id)) return fail('invalid_oauth_state')
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) return fail('google_not_configured')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code, redirect_uri: process.env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code',
    }), signal: AbortSignal.timeout(15_000),
  })
  if (!tokenRes.ok) return fail('google_token_exchange_failed')
  const tokens = await tokenRes.json() as { access_token?: string; refresh_token?: string }
  if (!tokens.access_token || !tokens.refresh_token) return fail('google_refresh_token_missing')

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000),
  })
  if (!profileRes.ok) return fail('google_profile_failed')
  const profile = await profileRes.json() as { email?: string }
  const fromEmail = profile.email?.trim().toLowerCase()
  if (!fromEmail) return fail('google_email_missing')

  const { data: sender, error } = await supabase.from('sender_accounts').insert({
    user_id: user.id, provider: 'gmail', display_name: 'Gmail', from_email: fromEmail, status: 'active',
  } as never).select('id').single()
  if (error || !sender) return fail('sender_save_failed')
  try {
    const encrypted = encryptToken(tokens.refresh_token, sender.id)
    const { error: tokenError } = await supabase.from('sender_accounts').update({
      encrypted_refresh_token: encrypted.ciphertext, token_iv: encrypted.iv, token_tag: encrypted.tag,
    } as never).eq('id', sender.id)
    if (tokenError) throw tokenError
  } catch (error) {
    await supabase.from('sender_accounts').delete().eq('id', sender.id)
    console.error('Could not persist encrypted Gmail token:', error)
    return fail('sender_token_save_failed')
  }
  await audit(user.id, 'sender.gmail.connected', 'sender_account', sender.id, { fromEmail })
  const response = NextResponse.redirect(new URL('/dashboard/senders?connected=gmail', request.url))
  response.cookies.delete('mailpilot_google_oauth_state')
  return response
}
__END__

w app/api/ai/draft/route.ts <<'__END__'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireUserOr401 } from '@/lib/auth/require-user'
import { getAIProvider } from '@/lib/ai'
import { validateAiDraft } from '@/lib/ai/validation'
import { aiDraftLimiter, checkLimit } from '@/lib/security/rate-limit'
import { audit } from '@/lib/security/audit'
const schema = z.object({
  topic: z.string().min(5).max(1000),
  tone: z.enum(['professional', 'friendly', 'formal', 'direct']),
  variables: z.array(z.string().regex(/^[A-Za-z][\w.]{0,63}$/)).max(30),
  sampleValues: z.record(z.string()).optional(),
})
export async function POST(req: NextRequest) {
  if (!process.env.AI_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })
  const { user } = await requireUserOr401()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  let limit: Awaited<ReturnType<typeof checkLimit>>
  try { limit = await checkLimit(aiDraftLimiter, user.id) }
  catch { return NextResponse.json({ error: 'Rate limiting is unavailable; configure Upstash Redis.' }, { status: 503 }) }
  if (!limit.ok) return NextResponse.json({ error: 'Rate limit' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } })
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  try {
    const provider = getAIProvider()
    const draft = await provider.draft({
      topic: parsed.data.topic, tone: parsed.data.tone,
      variables: parsed.data.variables, sampleValues: parsed.data.sampleValues ?? {},
    })
    const validation = validateAiDraft(draft, parsed.data.variables)
    await audit(user.id, 'ai.draft.generated', 'ai', undefined, { tone: parsed.data.tone, valid: validation.valid })
    return NextResponse.json({ ...draft, validation })
  } catch (error) {
    console.error('[ai-draft]', error)
    return NextResponse.json({ error: 'Could not generate a draft right now.' }, { status: 502 })
  }
}
__END__

w app/api/webhooks/resend/route.ts <<'__END__'
import { NextResponse, type NextRequest } from 'next/server'
import { Webhook } from 'svix'
import { createSupabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  const payload = await request.text()
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  if (!id || !timestamp || !signature) return NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 400 })

  let event: { type?: string; data?: { email_id?: string; to?: string[] } }
  try {
    event = new Webhook(secret).verify(payload, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }) as typeof event
  } catch { return NextResponse.json({ error: 'Invalid signature' }, { status: 400 }) }

  const emailId = event.data?.email_id
  const type = event.type
  if (!emailId || !type) return NextResponse.json({ received: true })
  const eventMap: Record<string, { eventType: string; recipientStatus?: string; suppressionReason?: string }> = {
    'email.sent': { eventType: 'accepted_by_provider' },
    'email.delivered': { eventType: 'delivered', recipientStatus: 'delivered' },
    'email.bounced': { eventType: 'bounced', recipientStatus: 'bounced', suppressionReason: 'bounce' },
    'email.complained': { eventType: 'complained', recipientStatus: 'bounced', suppressionReason: 'complaint' },
  }
  const mapped = eventMap[type]
  if (!mapped) return NextResponse.json({ received: true })

  const admin = createSupabaseAdmin()
  const { data: recipient, error: recipientError } = await admin.from('campaign_recipients')
    .select('id,user_id').eq('provider_message_id', emailId).maybeSingle()
  if (recipientError) return NextResponse.json({ error: 'Could not locate recipient' }, { status: 500 })
  if (!recipient) return NextResponse.json({ received: true })
  const { data: job, error: jobError } = await admin.from('sending_jobs')
    .select('id,user_id').eq('campaign_recipient_id', recipient.id).maybeSingle()
  if (jobError) return NextResponse.json({ error: 'Could not locate sending job' }, { status: 500 })
  if (!job) return NextResponse.json({ received: true })

  const { error: eventError } = await admin.from('sending_events').upsert({
    user_id: job.user_id, sending_job_id: job.id, event_type: mapped.eventType,
    provider_event_id: id, provider_payload: event,
  } as never, { onConflict: 'sending_job_id,event_type,provider_event_id' })
  if (eventError) return NextResponse.json({ error: 'Could not save event' }, { status: 500 })

  if (mapped.recipientStatus) {
    const { error } = await admin.from('campaign_recipients').update({ status: mapped.recipientStatus } as never).eq('id', recipient.id)
    if (error) return NextResponse.json({ error: 'Could not update recipient status' }, { status: 500 })
  }
  if (mapped.suppressionReason) {
    const email = event.data?.to?.[0]?.toLowerCase()
    if (email) {
      const { error } = await admin.from('suppressions').upsert({
        user_id: job.user_id, email, reason: mapped.suppressionReason,
      } as never, { onConflict: 'user_id,email' })
      if (error) return NextResponse.json({ error: 'Could not save suppression' }, { status: 500 })
      await admin.from('contacts').update({ consent_confirmed: false } as never).eq('user_id', job.user_id).ilike('email', email)
    }
  }
  return NextResponse.json({ received: true })
}
__END__

# ============================================================ WORKER
w worker/index.ts <<'__END__'
import PgBoss from 'pg-boss'
import { createClient } from '@supabase/supabase-js'
import { gmailProvider } from '../lib/providers/gmail'
import { resendProvider } from '../lib/providers/resend'
import { decryptToken } from '../lib/crypto/token-vault'
import { ProviderError, type ProviderCredentials } from '../lib/providers/types'

const DAILY_LIMIT = Number.parseInt(process.env.USER_DAILY_LIMIT ?? '100', 10)
if (!Number.isInteger(DAILY_LIMIT) || DAILY_LIMIT < 1) throw new Error('USER_DAILY_LIMIT must be a positive integer')
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'TOKEN_ENCRYPTION_KEY']) {
  if (!process.env[key]) throw new Error(`${key} is required by the MailPilot worker`)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL!, schema: 'pgboss',
  retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300,
})
boss.on('error', error => console.error('[pg-boss]', error))

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const { error } = await admin.from('sending_jobs').update(values as never).eq('id', jobId)
  if (error) throw error
}
async function settleJob(jobId: string, status: 'failed'|'suppressed'|'cancelled', message: string) {
  const { error } = await admin.rpc('settle_sending_job', {
    p_job_id: jobId, p_status: status, p_message: message.slice(0, 1000),
  } as never)
  if (error) throw error
}
async function failJob(jobId: string, _recipientId: string, message: string) {
  await settleJob(jobId, 'failed', message)
}
async function deferJob(jobId: string, delaySeconds: number) {
  await updateJob(jobId, { status: 'deferred', locked_at: null, provider_handoff_started_at: null, scheduled_at: new Date(Date.now() + delaySeconds * 1000).toISOString() })
  // A unique retry key avoids pg-boss deduplicating a retry against the currently running job.
  await boss.send('send-email', { sendingJobId: jobId }, { startAfter: delaySeconds, singletonKey: `${jobId}:defer:${Date.now()}` })
}

async function processSendingJob(sendingJobId: string) {
  const { data: job, error: jobError } = await admin.from('sending_jobs')
    .select('*').eq('id', sendingJobId).maybeSingle()
  if (jobError) throw jobError
  if (!job || !['pending', 'deferred', 'processing'].includes(job.status)) return

  // Atomic database-side claim: duplicate pg-boss deliveries cannot send simultaneously.
  // A 2-minute lease lets another worker recover a job after an unexpected process crash.
  const { data: claimRows, error: claimError } = await admin.rpc('claim_sending_job', { p_job_id: sendingJobId })
  if (claimError) throw claimError
  const claimed = Array.isArray(claimRows) ? claimRows[0] as Record<string, any> | undefined : undefined
  if (!claimed) {
    if (['pending', 'deferred'].includes(job.status) && job.attempts >= job.max_attempts) {
      await failJob(job.id, job.campaign_recipient_id, 'Maximum provider attempts reached; review provider status before retrying.')
      return
    }
    const stale = job.status === 'processing' && (!job.locked_at || Date.now() - new Date(job.locked_at).getTime() > 120_000)
    if (stale && job.provider_handoff_started_at) {
      await failJob(job.id, job.campaign_recipient_id, 'Provider hand-off started but no completion was recorded. Delivery outcome is uncertain; check the provider before any manual retry.')
    } else if (stale && job.attempts >= job.max_attempts) {
      await failJob(job.id, job.campaign_recipient_id, 'Worker lease expired and maximum attempts were reached; review provider status before retrying.')
    } else if (stale && !job.locked_at) {
      await failJob(job.id, job.campaign_recipient_id, 'Processing job has no lease timestamp; review provider status before retrying.')
    } else if (job.status === 'processing' && job.locked_at) {
      const leaseRemaining = Math.max(15, Math.ceil((new Date(job.locked_at).getTime() + 120_000 - Date.now()) / 1000))
      await boss.send('send-email', { sendingJobId }, {
        startAfter: leaseRemaining,
        singletonKey: `${sendingJobId}:leasecheck:${Math.floor(Date.now() / 120_000)}`,
      })
    }
    return
  }

  const { data: recipient, error: recipientError } = await admin.from('campaign_recipients')
    .select('*').eq('id', claimed.campaign_recipient_id).maybeSingle()
  if (recipientError) { await failJob(claimed.id, claimed.campaign_recipient_id, 'Could not load campaign recipient'); throw recipientError }
  if (!recipient) { await updateJob(claimed.id, { status: 'failed', locked_at: null, last_error: 'Recipient record not found' }); return }

  const { data: campaign, error: campaignError } = await admin.from('campaigns')
    .select('*').eq('id', recipient.campaign_id).maybeSingle()
  if (campaignError) { await failJob(claimed.id, recipient.id, 'Could not load campaign'); throw campaignError }
  if (!campaign || !campaign.approved_at || !['queued', 'sending'].includes(campaign.status)) {
    await settleJob(claimed.id, 'cancelled', 'Campaign is not active')
    return
  }
  if (campaign.status === 'queued') {
    await admin.from('campaigns').update({ status: 'sending' } as never).eq('id', campaign.id).eq('status', 'queued')
  }

  const { data: sender, error: senderError } = await admin.from('sender_accounts')
    .select('*').eq('id', campaign.sender_account_id).maybeSingle()
  if (senderError) { await failJob(claimed.id, recipient.id, 'Could not load sender account'); throw senderError }
  if (!sender || sender.status !== 'active') { await failJob(claimed.id, recipient.id, 'Sender is not active'); return }

  const { data: contact, error: contactError } = await admin.from('contacts')
    .select('*').eq('id', recipient.contact_id).maybeSingle()
  if (contactError) { await failJob(claimed.id, recipient.id, 'Could not load contact'); throw contactError }
  if (!contact || !contact.consent_confirmed) {
    await settleJob(claimed.id, 'suppressed', 'Contact has no active opt-in confirmation')
    return
  }
  const { data: suppression, error: suppressionError } = await admin.from('suppressions')
    .select('id').eq('user_id', claimed.user_id).ilike('email', contact.email).maybeSingle()
  if (suppressionError) { await failJob(claimed.id, recipient.id, 'Could not check suppression list'); throw suppressionError }
  if (suppression) {
    await settleJob(claimed.id, 'suppressed', 'Address is suppressed')
    return
  }

  const quota = await admin.rpc('reserve_usage_slot', {
    p_user_id: claimed.user_id, p_date: new Date().toISOString().slice(0, 10), p_daily_limit: DAILY_LIMIT,
  } as never)
  if (quota.error) { await failJob(claimed.id, recipient.id, 'Could not reserve daily sending quota'); throw quota.error }
  if (!quota.data) {
    await deferJob(claimed.id, 3600)
    return
  }
  const { data: attempted, error: attemptError } = await admin.from('sending_jobs')
    .update({ attempts: Number(claimed.attempts) + 1 } as never).eq('id', claimed.id).eq('status', 'processing')
    .select('attempts').single()
  if (attemptError || !attempted) {
    await updateJob(claimed.id, { status: 'pending', locked_at: null, last_error: 'Could not record provider attempt' })
    throw attemptError ?? new Error('Could not record provider attempt')
  }
  const attemptCount = attempted.attempts

  let credentials: ProviderCredentials
  let unsubscribeUrl: string
  try {
    unsubscribeUrl = new URL('/unsubscribe', process.env.NEXT_PUBLIC_APP_URL).toString()
    const tokenFromText = recipient.rendered_text.match(/https?:\/\/[^\s]+/g)?.find((url: string) => url.includes('/unsubscribe?token='))
    if (tokenFromText) unsubscribeUrl = tokenFromText.replace(/[)>.,]+$/, '')
    else {
      const tokenFromHtml = recipient.rendered_html.match(/href="([^"]*\/unsubscribe\?token=[^"]+)"/i)?.[1]
      if (tokenFromHtml) unsubscribeUrl = tokenFromHtml.replace(/&amp;/g, '&')
    }
    if (!unsubscribeUrl.includes('token=')) throw new Error('Recipient unsubscribe URL is missing')
    if (sender.provider === 'gmail') {
      if (!sender.encrypted_refresh_token || !sender.token_iv || !sender.token_tag) throw new Error('Gmail refresh token is missing; reconnect the sender.')
      credentials = { kind: 'gmail', refreshToken: decryptToken({
        ciphertext: sender.encrypted_refresh_token, iv: sender.token_iv, tag: sender.token_tag,
      }, sender.id) }
    } else {
      if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured')
      credentials = { kind: 'resend', apiKey: process.env.RESEND_API_KEY }
    }
  } catch (error) {
    await failJob(claimed.id, recipient.id, error instanceof Error ? error.message : 'Could not prepare provider credentials')
    return
  }

  const provider = sender.provider === 'gmail' ? gmailProvider : resendProvider
  try {
    // Re-check campaign state immediately before calling the provider. An already in-flight
    // request cannot be recalled, but cancellation prevents later recipients from starting.
    const { data: latestCampaign } = await admin.from('campaigns').select('status').eq('id', campaign.id).maybeSingle()
    if (!latestCampaign || !['queued', 'sending'].includes(latestCampaign.status)) {
      await settleJob(claimed.id, 'cancelled', 'Campaign cancelled before provider hand-off')
      return
    }
    const { data: handoffStarted, error: handoffError } = await admin.rpc('begin_provider_handoff', { p_job_id: claimed.id })
    if (handoffError) throw handoffError
    if (!handoffStarted) {
      await settleJob(claimed.id, 'cancelled', 'Campaign was cancelled before provider hand-off')
      return
    }
    const result = await provider.send({
      to: contact.email, subject: recipient.rendered_subject, html: recipient.rendered_html,
      text: recipient.rendered_text, fromEmail: sender.from_email, fromName: sender.from_name,
      replyTo: sender.reply_to, unsubscribeUrl, idempotencyKey: claimed.idempotency_key,
    }, credentials)
    const { error: acceptedError } = await admin.rpc('record_provider_accepted', {
      p_job_id: claimed.id, p_message_id: result.providerMessageId, p_response: result.raw,
    } as never)
    if (acceptedError) throw acceptedError
    // Usage was reserved atomically before the provider hand-off.
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null
    const status = providerError?.status ?? 0
    const retryable = status === 429 || (sender.provider === 'resend' && status >= 500 && status < 600)
    const hasAttempts = attemptCount < claimed.max_attempts
    if (retryable && hasAttempts) {
      const delay = Math.min(Math.max(providerError?.retryAfterSeconds ?? 60, 30), 3600)
      await deferJob(claimed.id, delay)
      return
    }
    // Gmail has no provider idempotency key. A transport/5xx failure can be ambiguous, so do
    // not automatically resend it: mark it failed for human review rather than risk duplicates.
    const message = error instanceof Error ? error.message : 'Unknown provider error'
    const uncertain = status === 0 || (sender.provider === 'gmail' && status >= 500)
    await failJob(claimed.id, recipient.id, `${message}${uncertain ? ' (delivery outcome may be uncertain; check the provider before any manual retry)' : ''}`)
    if (status === 401 || status === 403) {
      await admin.from('sender_accounts').update({ status: 'error', last_error: message.slice(0, 500) } as never).eq('id', sender.id)
    }
  }
}

async function start() {
  await boss.start()
  await boss.createQueue('send-email')
  await boss.work('send-email', { batchSize: 1, pollingIntervalSeconds: 2 }, async jobs => {
    for (const job of jobs) {
      const payload = job.data as { sendingJobId?: string }
      if (!payload?.sendingJobId) {
        console.error('[worker] Job has no sendingJobId:', job.id)
        continue
      }
      try {
        await processSendingJob(payload.sendingJobId)
      } catch (error) {
        const { data: stuck } = await admin.from('sending_jobs')
          .select('id,status,provider_handoff_started_at,campaign_recipient_id')
          .eq('id', payload.sendingJobId).maybeSingle()
        if (stuck?.status === 'processing' && stuck.provider_handoff_started_at) {
          await settleJob(stuck.id, 'failed', 'Worker failed after provider hand-off began; delivery outcome is uncertain. Check the provider before any manual retry.')
        } else if (stuck?.status === 'processing') {
          await updateJob(stuck.id, { status: 'pending', locked_at: null, last_error: error instanceof Error ? error.message.slice(0, 1000) : 'Worker error' })
        }
        throw error // pg-boss must see the failure so it can apply its configured retry policy.
      }
    }
  })
  console.log(`[worker] listening (daily limit ${DAILY_LIMIT}/user)`)
}
async function shutdown() {
  await boss.stop({ graceful: true, timeout: 30_000 })
  process.exit(0)
}
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
start().catch(error => { console.error('[worker] startup failed:', error); process.exit(1) })
__END__

w worker/tsconfig.json <<'__END__'
{
  "compilerOptions": {
    "target": "ES2022", "module": "commonjs", "moduleResolution": "node",
    "esModuleInterop": true, "strict": true, "skipLibCheck": true,
    "outDir": "../dist-worker", "rootDir": "..",
    "resolveJsonModule": true, "baseUrl": "..", "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "../lib/**/*.ts"],
  "exclude": ["../node_modules", "../app", "../components", "../lib/supabase", "../lib/auth"]
}
__END__

w worker/Dockerfile <<'__END__'
# Build from the project root:
# docker build -f worker/Dockerfile -t mailpilot-worker .
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
COPY package.json ./
# The generator intentionally does not commit a platform-specific lockfile.
# pnpm resolves dependencies at image build time; pin/commit pnpm-lock.yaml for strict reproducibility.
RUN pnpm install --no-frozen-lockfile --prod=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm worker:build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist-worker ./dist-worker
COPY package.json ./
CMD ["node", "dist-worker/worker/index.js"]
__END__

# ============================================================ SCRIPTS
w scripts/bootstrap.sh <<'__END__'
#!/usr/bin/env bash
set -euo pipefail
# UI primitives are generated directly by the MailPilot generator.
# This script is retained as a compatibility step for existing setup instructions.
for file in components/ui/button.tsx components/ui/input.tsx components/ui/label.tsx; do
  [[ -s "$file" ]] || { echo "Missing generated UI component: $file" >&2; exit 1; }
done
echo "✓ MailPilot UI primitives are ready. No shadcn CLI installation is required."
__END__
chmod +x scripts/bootstrap.sh

# ============================================================ TESTS
w vitest.config.ts <<'__END__'
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] } })
__END__

w tests/unit/render.test.ts <<'__END__'
import { describe, it, expect } from 'vitest'
import { renderSubject, renderHtml, renderText, extractVariables } from '../../lib/personalization/render'
import { MissingVariableError } from '../../lib/personalization/errors'
import { signUnsubscribe } from '../../lib/personalization/unsubscribe'

describe('personalization renderers', () => {
  it('escapes HTML contact values', () => {
    expect(renderHtml('<p>{{name}}</p>', { name: '<script>x</script>' }))
      .toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>')
  })
  it('removes CRLF from subjects', () => {
    expect(renderSubject('Hi {{name}}', { name: 'Alex\r\nBcc: evil@example.com' }))
      .toBe('Hi Alex Bcc: evil@example.com')
  })
  it('throws on missing variables', () => {
    expect(() => renderHtml('{{missing}}', {})).toThrow(MissingVariableError)
  })
  it('extracts unique variables', () => {
    expect(extractVariables('{{a}} {{ a }} {{b}}')).toEqual(['a', 'b'])
  })
  it('renders text without HTML escaping', () => {
    expect(renderText('Hello {{name}}', { name: '<Alex>' })).toBe('Hello <Alex>')
  })
  it('creates a signed unsubscribe token', () => {
    process.env.UNSUBSCRIBE_JWT_SECRET = 'test-secret-that-is-long-enough-for-tests'
    expect(signUnsubscribe('contact-id', 'user-id')).toContain('.')
  })
})
__END__

# ============================================================ README
w README.md <<'__END__'
# MailPilot

MailPilot is a consent-first, personalized email workflow for small, legitimate recipient lists. It uses Next.js 15, Supabase Auth/Postgres/RLS, a separate pg-boss worker, and Gmail or Resend as the delivery provider.

## What is included

- Sign-up, login, password reset, protected dashboard, and admin route guard.
- Gmail OAuth with browser-bound signed state and AES-256-GCM encrypted refresh tokens.
- Manual contacts and CSV import (max 500 rows / 2 MB) with an explicit opt-in confirmation step, consent audit events, and safe custom personalization fields such as `boarding_code` and `flight_number`.
- Explicit campaign recipient selection; suppressed and non-consented contacts are excluded and rechecked by the worker.
- Per-recipient personalization with HTML escaping for contact values and missing-variable checks.
- Mandatory unsubscribe footer, List-Unsubscribe and RFC 8058 one-click headers, plus confirmation-based unsubscribe.
- Approval-before-queue, background sending, idempotency keys, retries for provider-safe failures, rate limits, atomic daily sending quota, and delivery-event webhooks.
- Unit tests for personalization and token generation.

## Local setup

1. Create a Supabase project and enable email/password authentication.
2. Copy `.env.example` to `.env.local` and configure the required values.
3. Install dependencies: `pnpm install` (or `npm install`).
4. Apply both migrations in `supabase/migrations` using Supabase CLI or the SQL editor, in filename order.
5. Start the web app: `pnpm dev`.
6. In another terminal start the worker: `pnpm worker:dev`.
7. Run checks: `pnpm typecheck` and `pnpm test:unit`.

### Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server/worker only; never expose it to the browser)
- `DATABASE_URL` (Postgres connection for pg-boss; use a connection method compatible with long-lived workers)
- `NEXT_PUBLIC_APP_URL`
- `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`)
- `UNSUBSCRIBE_JWT_SECRET` (`openssl rand -base64 32`)
- `OAUTH_STATE_SECRET` (at least 32 characters; `openssl rand -base64 32`)

### Optional services

- Gmail: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Configure the exact callback URL in Google Cloud. Gmail OAuth verification and send quotas are controlled by Google.
- Resend: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`. The delivery adapter is included, but self-service per-user domain verification is not implemented in this scaffold; only use administrator-provisioned verified sender records. Configure the webhook URL `/api/webhooks/resend`.
- AI drafting: `AI_API_KEY`. AI output is a draft and must be reviewed; it must not invent recipient-specific codes or facts.
- Distributed rate limits: configure both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Production requests fail closed when Redis is missing. Local development uses a process-local limiter only.

## CSV format

```csv
email,name,company,boarding_code,flight_number
person@example.com,Alex,Example Ltd,AB1234,XY210
another@example.com,Sam,Sample Co,CD5678,XY211
```

You must confirm that every row has explicitly opted in and provide the source of that consent. This confirmation is an account-owner attestation and is not an independent verification service. Do not upload purchased, scraped, rented, or unsolicited lists. Importing an address does not prove consent by itself.

## Worker deployment

Build from the repository root (not from inside `worker/`):

```bash
docker build -f worker/Dockerfile -t mailpilot-worker .
```

Run the worker as a separate long-lived process with the same required environment variables as the web app. For reproducible deployment, generate and commit your package-manager lockfile before building images.

## Delivery semantics and important limitations

- The atomic daily quota reserves a slot immediately before provider hand-off; failed provider attempts still consume a slot to prevent concurrent workers exceeding the configured ceiling.
- A successful provider API response means **accepted by the provider**, not guaranteed inbox delivery. Delivery, bounce, and complaint statuses require a correctly configured provider webhook.
- Resend retries use the same idempotency key. Gmail does not expose an equivalent send idempotency key; the worker records a provider hand-off marker and treats a crash or ambiguous Gmail outcome as manual-review work rather than automatically resending it.
- Stopping a campaign blocks jobs that have not been handed to the provider. A request already in flight cannot be recalled.
- The worker uses a separate Postgres queue. Deploy it independently and monitor worker logs, queue health, and webhook failures.
- The account-owner opt-in checkbox is an attestation, not proof that a recipient consented. You are responsible for lawful basis, consent records, sender identity, local email rules, and honoring all opt-outs.
- This generated scaffold still requires a real environment integration test (Supabase, Google/Resend, and pg-boss) before production use. No live email was sent during project generation or testing.

## Commands

```bash
pnpm dev
pnpm worker:dev
pnpm typecheck
pnpm test:unit
pnpm worker:build
```
__END__

echo ""
echo "✓ MailPilot created at $ROOT/"
echo "  Files: $(find . -type f | wc -l | tr -d ' ')"
echo ""
echo "Next:"
echo "  cd $ROOT"
echo "  cp .env.example .env.local   # fill in secrets"
echo "  pnpm install"
echo "  pnpm bootstrap                 # verifies local UI components"
echo "  pnpm typecheck"
echo "  pnpm test:unit"
echo "  pnpm worker:dev               # in a second terminal"
echo "  pnpm exec supabase db push   # needs Supabase CLI + linked project"
echo "  pnpm dev"