import { execFile } from "node:child_process";
import { ok, err, Result } from "neverthrow";

// ─── Types ──────────────────────────────────────────────

export interface TmuxSession {
  sessionName: string;
  jobId: string;
}

export interface TmuxPane {
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  role: string;
}

export class TmuxError extends Error {
  constructor(
    message: string,
    public readonly command?: string,
  ) {
    super(message);
    this.name = "TmuxError";
  }
}

// ─── Helper ─────────────────────────────────────────────

function execTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new TmuxError(
          `tmux ${args.join(" ")} failed: ${stderr || error.message}`,
          `tmux ${args.join(" ")}`,
        ));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ─── Controller ─────────────────────────────────────────

export class TmuxController {
  constructor(private readonly sessionPrefix: string = "job") {}

  private sessionName(jobId: string): string {
    return `${this.sessionPrefix}-${jobId}`;
  }

  private paneTarget(pane: TmuxPane): string {
    return `${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex}`;
  }

  async createSession(
    jobId: string,
    width: number = 200,
    height: number = 50,
  ): Promise<Result<TmuxSession, TmuxError>> {
    const name = this.sessionName(jobId);
    try {
      await execTmux([
        "new-session",
        "-d",
        "-s", name,
        "-x", String(width),
        "-y", String(height),
      ]);
      return ok({ sessionName: name, jobId });
    } catch (e) {
      return err(e instanceof TmuxError ? e : new TmuxError(String(e)));
    }
  }

  async splitPane(
    session: TmuxSession,
    role: string,
  ): Promise<Result<TmuxPane, TmuxError>> {
    try {
      await execTmux([
        "split-window",
        "-t", session.sessionName,
        "-v",
      ]);

      // Re-resolve panes to get the latest pane index
      const panes = await this.listPanes(session);
      const lastPane = panes[panes.length - 1];

      return ok({
        sessionName: session.sessionName,
        windowIndex: 0,
        paneIndex: lastPane.paneIndex,
        role,
      });
    } catch (e) {
      return err(e instanceof TmuxError ? e : new TmuxError(String(e)));
    }
  }

  async tileLayout(session: TmuxSession): Promise<Result<void, TmuxError>> {
    try {
      await execTmux(["select-layout", "-t", session.sessionName, "tiled"]);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof TmuxError ? e : new TmuxError(String(e)));
    }
  }

  async sendKeys(
    pane: TmuxPane,
    text: string,
  ): Promise<Result<void, TmuxError>> {
    try {
      const target = this.paneTarget(pane);
      await execTmux(["send-keys", "-t", target, text, "Enter"]);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof TmuxError ? e : new TmuxError(String(e)));
    }
  }

  async capturePane(
    pane: TmuxPane,
    lines: number = 1000,
  ): Promise<Result<string, TmuxError>> {
    try {
      const target = this.paneTarget(pane);
      const output = await execTmux([
        "capture-pane",
        "-t", target,
        "-p",
        "-S", `-${lines}`,
      ]);
      return ok(output);
    } catch (e) {
      return err(e instanceof TmuxError ? e : new TmuxError(String(e)));
    }
  }

  async killSession(
    session: TmuxSession,
  ): Promise<Result<void, TmuxError>> {
    try {
      await execTmux(["kill-session", "-t", session.sessionName]);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof TmuxError ? e : new TmuxError(String(e)));
    }
  }

  async isSessionAlive(session: TmuxSession): Promise<boolean> {
    try {
      await execTmux(["has-session", "-t", session.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<TmuxSession[]> {
    try {
      const output = await execTmux([
        "list-sessions",
        "-F", "#{session_name}",
      ]);
      if (!output) return [];

      const prefix = `${this.sessionPrefix}-`;
      return output
        .split("\n")
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({
          sessionName: name,
          jobId: name.slice(prefix.length),
        }));
    } catch {
      return [];
    }
  }

  async listPanes(session: TmuxSession): Promise<TmuxPane[]> {
    const output = await execTmux([
      "list-panes",
      "-t", session.sessionName,
      "-F", "#{pane_index}",
    ]);
    if (!output) return [];

    return output.split("\n").filter(Boolean).map((line) => ({
      sessionName: session.sessionName,
      windowIndex: 0,
      paneIndex: parseInt(line, 10),
      role: "",
    }));
  }

  /**
   * Create a full session with AI-chan pane (index 0) and N Kobito panes.
   */
  async createJobSession(
    jobId: string,
    kobitoCount: number,
    width: number = 200,
    height: number = 50,
  ): Promise<Result<{ session: TmuxSession; panes: TmuxPane[] }, TmuxError>> {
    const sessionResult = await this.createSession(jobId, width, height);
    if (sessionResult.isErr()) return err(sessionResult.error);
    const session = sessionResult.value;

    const panes: TmuxPane[] = [];

    // First pane (auto-created with session) is AI-chan
    const initialPanes = await this.listPanes(session);
    if (initialPanes.length > 0) {
      panes.push({ ...initialPanes[0], role: "ai-chan" });
    }

    // Create Kobito panes
    for (let i = 1; i <= kobitoCount; i++) {
      const paneResult = await this.splitPane(session, `kobito-${i}`);
      if (paneResult.isErr()) {
        // Clean up on failure
        await this.killSession(session);
        return err(paneResult.error);
      }
      panes.push(paneResult.value);
    }

    // Arrange panes
    await this.tileLayout(session);

    return ok({ session, panes });
  }
}
