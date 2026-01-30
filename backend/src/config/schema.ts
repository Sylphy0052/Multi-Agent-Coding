import { z } from "zod";

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
});

export const AuthConfigSchema = z.object({
  username: z.string().min(1).default("admin"),
  password: z.string().min(1).default("changeme"),
});

export const EstimationConfigSchema = z.object({
  base_gb: z.number().positive().default(2),
  gb_per_agent: z.number().positive().default(0.8),
  gb_per_job_overhead: z.number().positive().default(1.0),
  mem_per_job_gb: z.number().positive().default(6),
  min_cpu_per_job: z.number().positive().default(4),
});

export const OrchestratorConfigSchema = z.object({
  max_jobs: z.union([z.literal("auto"), z.number().int().min(1)]).default("auto"),
  max_jobs_hard_limit: z.number().int().min(1).default(4),
  state_dir: z.string().default(".orchestrator/state"),
  tmp_dir: z.string().default("/tmp/orchestrator"),
  default_parallelism: z.number().int().min(1).max(10).default(2),
});

export const TmuxConfigSchema = z.object({
  session_prefix: z.string().default("job"),
  default_width: z.number().int().default(200),
  default_height: z.number().int().default(50),
});

export const ClaudeConfigSchema = z.object({
  skip_permissions: z.boolean().default(true),
  model: z.string().default("sonnet"),
  output_format: z.enum(["text", "json", "stream-json"]).default("json"),
  max_budget_usd: z.number().positive().default(5.0),
  timeout_seconds: z.number().int().positive().default(600),
});

export const GitConfigSchema = z.object({
  main_branch: z.string().default("main"),
  develop_branch: z.string().default("develop"),
  merge_policy: z.literal("merge_commit").default("merge_commit"),
  lock_timeout_ms: z.number().int().positive().default(30000),
  lock_retries: z.number().int().min(0).default(3),
});

export const RetryConfigSchema = z.object({
  max_retries: z.number().int().min(0).default(10),
  backoff_sequence: z.array(z.number().positive()).default([10, 30, 60, 120, 240, 480, 600]),
  backoff_cap: z.number().positive().default(600),
});

export const PersonasConfigSchema = z.object({
  active_set: z.string().default("default"),
  directory: z.string().default("config/personas"),
});

export const MemoryConfigSchema = z.object({
  directory: z.string().default("memory"),
});

export const SkillsConfigSchema = z.object({
  directory: z.string().default("skills"),
});

export const TemplatesConfigSchema = z.object({
  context_template: z.string().default("templates/context_template.md"),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  estimation: EstimationConfigSchema.default({}),
  orchestrator: OrchestratorConfigSchema.default({}),
  tmux: TmuxConfigSchema.default({}),
  claude: ClaudeConfigSchema.default({}),
  git: GitConfigSchema.default({}),
  retry: RetryConfigSchema.default({}),
  personas: PersonasConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  templates: TemplatesConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type EstimationConfig = z.infer<typeof EstimationConfigSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type RetryConfig = z.infer<typeof RetryConfigSchema>;
export type PersonasConfig = z.infer<typeof PersonasConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type TemplatesConfig = z.infer<typeof TemplatesConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
