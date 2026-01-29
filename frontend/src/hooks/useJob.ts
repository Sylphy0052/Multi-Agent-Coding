import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/client";

export function useJobs(params?: { status?: string }) {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => api.listJobs(params),
    refetchInterval: 5000,
  });
}

export function useJobDetail(id: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id),
    refetchInterval: 3000,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.cancelJob,
    onSuccess: (_data, jobId) => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useApprovePhase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, phase }: { jobId: string; phase: string }) =>
      api.approvePhase(jobId, phase),
    onSuccess: (_data, { jobId }) => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useRejectPhase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      phase,
      reason,
    }: {
      jobId: string;
      phase: string;
      reason: string;
    }) => api.rejectPhase(jobId, phase, reason),
    onSuccess: (_data, { jobId }) => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
