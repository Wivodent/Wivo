/**
 * "New activity" marks (sql/136): which jobs have something new for me, and
 * "I opened this job".
 *
 * One query for the whole board (React Query shares it between the cards),
 * refreshed when a job, a file, a message or my own job_seen row changes, on
 * any computer (the last one is how opening a job on the phone clears the
 * mark on the desktop at once). A database without sql/136 shows no marks
 * and says nothing.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { activityByJob, type JobActivity } from '../lib/jobActivity'
import { useRealtimeInvalidate } from './useRealtimeInvalidate'
import { useAuth } from '../context/AuthContext'

export const JOB_ACTIVITY_KEY = ['job_activity'] as const

const missing = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883'

export function useJobActivity(): Map<string, JobActivity> {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: [...JOB_ACTIVITY_KEY, user?.id ?? null],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc('job_activity')
      if (error) {
        if (missing(error.code)) return new Map<string, JobActivity>()
        throw error
      }
      return activityByJob(rows as JobActivity[])
    },
  })
  return data ?? new Map()
}

/** Mounted ONCE where the cards are (the board, the phone's list): the realtime channels. */
export function useJobActivityLive(enabled = true): void {
  const keys = [JOB_ACTIVITY_KEY] as const
  useRealtimeInvalidate('jobs', keys, enabled)
  useRealtimeInvalidate('job_file', keys, enabled)
  useRealtimeInvalidate('messages', keys, enabled)
  useRealtimeInvalidate('job_seen', keys, enabled)
}

/** Opening a job marks it seen for me; the mark goes at once, here and on my other devices. */
export function useMarkJobSeen(jobId: string | null | undefined): void {
  const qc = useQueryClient()
  const { user } = useAuth()
  const mark = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_job_seen', { p_job: id })
      if (error && !missing(error.code)) throw error
    },
    onMutate: (id: string) => {
      qc.setQueriesData<Map<string, JobActivity>>({ queryKey: JOB_ACTIVITY_KEY }, old => {
        if (!old?.has(id)) return old
        const next = new Map(old)
        next.delete(id)
        return next
      })
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: JOB_ACTIVITY_KEY }) },
  })
  const { mutate } = mark
  useEffect(() => {
    if (jobId && user) mutate(jobId)
  }, [jobId, user, mutate])
}
