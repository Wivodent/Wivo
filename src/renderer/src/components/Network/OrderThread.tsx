/**
 * An order's conversation, as the clinic sees it (sql/138, 143): the
 * messages both ways with their files, the files sent with the order, and
 * the reviews. Shown in the order's dialog on the Orders page and on the job
 * page of the job the order became, so the talk goes on in one place.
 *
 *  - A picture is a preview (a tap opens it large); a scan, a PDF or anything
 *    else is an icon and its name. Every file comes through file-link: the
 *    person's rights and an audit entry, then a 60-second link.
 *  - A message can carry several files and can ask "Needs your review". The
 *    client answers Approve, or Request changes with a comment; the answer
 *    shows on the message it answers and in the conversation.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Paperclip, PencilLine, Send, X } from 'lucide-react'
import { format } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrderThread, useNetworkClients, clientName, PORTAL_KEY } from '../../hooks/useNetworkPortal'
import { usePermissions } from '../../hooks/usePermissions'
import { supabase } from '../../lib/supabase'
import { orderFileUrl, saveOrderFile } from '../../lib/fileLink'
import { sendOrderMessage } from '../../lib/orderMessages'
import { threadItems, reviewAnswer, latestReview, isImageFile, fileBadge, type ThreadFile, type ThreadMessage } from '../../lib/orderView'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

const when = (iso: string) => format(new Date(iso), 'd MMM yyyy HH:mm', { locale: dateLocale })

export function OrderThread({ orderId, clientName, canWrite, showOrderFiles = true }: {
  orderId: string
  clientName: string
  canWrite: boolean
  /** The files sent with the order itself (not with a message). */
  showOrderFiles?: boolean
}) {
  const thread = useOrderThread(orderId).data
  const messages = (thread?.messages ?? []) as (ThreadMessage & { id: string })[]
  const files = (thread?.files ?? []) as ThreadFile[]
  const { messages: items, orderFiles } = threadItems(messages, files)
  const [error, setError] = useState<string | null>(null)
  const [large, setLarge] = useState<{ url: string; name: string } | null>(null)

  return (
    <div className="space-y-4">
      {showOrderFiles && orderFiles.length > 0 && (
        <div>
          <p className="label">{t('orders.files')}</p>
          <FileList files={orderFiles} onError={setError} onOpenLarge={setLarge} />
        </div>
      )}

      <div>
        <p className="label">{t('orders.messages')}</p>
        <div className="space-y-2">
          {items.map(m => {
            if (m.review_of && m.review_state) {
              return (
                <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-base ${m.review_state === 'approved' ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                  <p className="flex items-center gap-1 font-semibold">
                    {m.review_state === 'approved' ? <CheckCircle2 size={16} aria-hidden="true" /> : <PencilLine size={16} aria-hidden="true" />}
                    {m.review_state === 'approved' ? t('orders.reviewApproved') : t('orders.reviewChanges')}
                  </p>
                  {m.body !== '✓' && <p className="whitespace-pre-wrap">{m.body}</p>}
                  <p className="text-xs text-ink-muted">{clientName} · {when(m.created_at)}</p>
                </div>
              )
            }
            const answer = m.needs_review ? reviewAnswer(m.id, messages) : null
            return (
              <div key={m.id} className={`max-w-[85%] space-y-2 rounded-xl px-3 py-2 text-base ${m.from_client ? 'bg-bg-sidebar' : 'ml-auto bg-accent/10'}`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.files.length > 0 && <FileList files={m.files} onError={setError} onOpenLarge={setLarge} />}
                {m.needs_review && (
                  <p className={`text-xs font-semibold ${answer ? (answer.review_state === 'approved' ? 'text-emerald-700' : 'text-amber-700') : 'text-sky-700'}`}>
                    {answer ? (answer.review_state === 'approved' ? t('orders.reviewApproved') : t('orders.reviewChanges')) : t('orders.reviewWaiting')}
                  </p>
                )}
                <p className="text-xs text-ink-muted">{m.from_client ? clientName : t('orders.us')} · {when(m.created_at)}</p>
              </div>
            )
          })}
        </div>
        {canWrite && <Compose orderId={orderId} onError={setError} />}
      </div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      {large && (
        <div role="dialog" aria-modal="true" aria-label={large.name} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => setLarge(null)}>
          <img src={large.url} alt={large.name} className="max-h-full max-w-full rounded-lg object-contain" />
          <button type="button" aria-label={t('orders.close')} className="absolute right-4 top-4 h-11 w-11 rounded-full bg-white/20 text-white"><X size={22} className="mx-auto" /></button>
        </div>
      )}
    </div>
  )
}

/** The latest review answer on an order, for the job page's heading. */
export function LatestReviewBadge({ orderId }: { orderId: string }) {
  const messages = (useOrderThread(orderId).data?.messages ?? []) as ThreadMessage[]
  const last = latestReview(messages)
  if (!last) return null
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${last.review_state === 'approved' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700'}`}>
      {last.review_state === 'approved' ? t('orders.reviewApproved') : t('orders.reviewChanges')} · {format(new Date(last.created_at), 'd MMM HH:mm', { locale: dateLocale })}
    </span>
  )
}

function FileList({ files, onError, onOpenLarge }: { files: ThreadFile[]; onError: (e: string) => void; onOpenLarge: (f: { url: string; name: string }) => void }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map(f => (
        <li key={f.id}>
          {isImageFile(f)
            ? <ImagePreview file={f} onError={onError} onOpenLarge={onOpenLarge} />
            : (
              <button type="button" className="flex h-14 items-center gap-2 rounded-xl border border-ink-faint/30 bg-bg-card px-2 text-left text-sm"
                onClick={async () => { try { await saveOrderFile(f.id, f.file_name) } catch (e) { onError(describeError(e)) } }}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-[10px] font-bold text-accent">{fileBadge(f.file_name) || <Paperclip size={14} aria-hidden="true" />}</span>
                <span className="max-w-[12rem] truncate">{f.file_name}</span>
                <Download size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
              </button>
            )}
        </li>
      ))}
    </ul>
  )
}

function ImagePreview({ file, onError, onOpenLarge }: { file: ThreadFile; onError: (e: string) => void; onOpenLarge: (f: { url: string; name: string }) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    orderFileUrl(file.id).then(u => { if (!stale) setUrl(u) }).catch(() => { /* the icon stays */ })
    return () => { stale = true }
  }, [file.id])
  return (
    <button type="button" title={file.file_name} aria-label={file.file_name}
      onClick={async () => { try { onOpenLarge({ url: await orderFileUrl(file.id), name: file.file_name }) } catch (e) { onError(describeError(e)) } }}
      className="block h-20 w-20 overflow-hidden rounded-xl border border-ink-faint/30 bg-bg-sidebar">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] font-bold text-ink-muted">{fileBadge(file.file_name)}</span>}
    </button>
  )
}

function Compose({ orderId, onError }: { orderId: string; onError: (e: string | null) => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [needsReview, setNeedsReview] = useState(false)
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true); onError(null)
    try {
      await sendOrderMessage(orderId, text.trim(), { needsReview, files })
      setText(''); setFiles([]); setNeedsReview(false)
    } catch (e) { onError(describeError(e)) } finally {
      setBusy(false)
      void qc.invalidateQueries({ queryKey: PORTAL_KEY })
    }
  }
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-ink-faint/20 p-3">
      <textarea className="input min-h-16 w-full text-base" value={text} onChange={e => setText(e.target.value)} placeholder={t('orders.writeMessage')} maxLength={4000} />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}:${i}`} className="flex items-center gap-1 rounded-lg bg-accent/5 px-2 py-1 text-sm">
              <span className="max-w-[10rem] truncate">{f.name}</span>
              <button type="button" aria-label={t('orders.removeFile', { name: f.name })} onClick={() => setFiles(list => list.filter((_, j) => j !== i))}
                className="rounded p-0.5 text-ink-muted hover:bg-bg-sidebar"><X size={14} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-ghost h-10 cursor-pointer border border-ink-faint/30 px-3 text-sm">
          <Paperclip size={16} aria-hidden="true" /> {t('orders.attachFiles')}
          <input type="file" multiple className="hidden" onChange={e => setFiles(f => [...f, ...(e.target.files ?? [])].slice(0, 20))} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={needsReview} onChange={e => setNeedsReview(e.target.checked)} />
          {t('orders.needsReview')}
        </label>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className="btn-primary ml-auto h-10 px-4 text-sm">
          <Send size={16} aria-hidden="true" /> {busy ? t('orders.sending') : t('orders.send')}
        </button>
      </div>
    </div>
  )
}

/**
 * On the job page of a job that came from a Network order: the order's
 * conversation goes on here, with the latest review answer in the heading.
 * Nothing for a job made any other way.
 */
export function JobOrderThread({ jobId }: { jobId: string }) {
  const { can } = usePermissions()
  const order = useQuery<{ id: string; client_id: string; patient_ref: string } | null>({
    queryKey: [...PORTAL_KEY, 'order-of-job-thread', jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_order').select('id, client_id, patient_ref').eq('job_id', jobId).limit(1)
      if (error) return null  // a database without orders, or no right to them
      return (data?.[0] as { id: string; client_id: string; patient_ref: string } | undefined) ?? null
    },
  }).data
  const clients = useNetworkClients(!!order).data ?? []
  if (!order) return null
  const client = clients.find(c => c.id === order.client_id)
  return (
    <section className="space-y-3 rounded-xl bg-bg-card px-5 py-4" aria-label={t('orders.orderConversation')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-base font-bold text-ink">{t('orders.orderConversation')} · {order.patient_ref}</h3>
        <LatestReviewBadge orderId={order.id} />
      </div>
      <OrderThread orderId={order.id} clientName={clientName(client)} canWrite={can('jobs.read') || can('jobs.write')} showOrderFiles={false} />
    </section>
  )
}
