import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import os from 'os';

const execAsync = promisify(exec);

export type ActionStatus = 'SUCCESS' | 'FAILED' | 'SIMULATED';

export interface ExecutionResult {
  action: string;
  status: ActionStatus;
  mode: string;
  ruleId?: string;
  errorMessage?: string;
}

export class ActionExecutor {
  private mode: string;
  private blockDuration: number;
  private hostIps: Set<string>;

  constructor() {
    this.mode = process.env.ACTION_EXECUTION_MODE || 'dry-run';
    this.blockDuration = parseInt(process.env.BLOCK_DURATION_SECONDS || '60', 10);
    this.hostIps = this.getLocalIps();
  }

  private getLocalIps(): Set<string> {
    const ips = new Set<string>();
    ips.add('127.0.0.1');
    ips.add('::1');
    
    const interfaces = os.networkInterfaces();
    for (const [name, nets] of Object.entries(interfaces)) {
      if (!nets) continue;
      for (const netInfo of nets) {
        ips.add(netInfo.address);
      }
    }
    return ips;
  }

  public async executeAction(action: string, sourceIp: string): Promise<ExecutionResult> {
    action = action.toUpperCase();

    if (action === 'ALLOW' || action === 'ALERT') {
      return {
        action,
        status: 'SUCCESS',
        mode: this.mode
      };
    }

    if (action === 'BLOCK') {
      // 1. Safety check: Valid IP
      if (!net.isIP(sourceIp)) {
        return {
          action,
          status: 'FAILED',
          mode: this.mode,
          errorMessage: `Safety rejection: Invalid IP address format (${sourceIp})`
        };
      }

      // 2. Safety check: Host/Local IP protection
      if (this.hostIps.has(sourceIp) || sourceIp.startsWith('127.')) {
        return {
          action,
          status: 'FAILED',
          mode: this.mode,
          errorMessage: `Safety rejection: Attempted to block host/loopback IP (${sourceIp})`
        };
      }

      const ruleId = `xrl-idars-${Date.now()}`;
      
      if (this.mode === 'dry-run') {
        console.log(`[Action Executor] DRY-RUN BLOCK: Would execute 'sudo iptables -I INPUT -s ${sourceIp} -j DROP -m comment --comment "${ruleId}"' for ${this.blockDuration} seconds`);
        return {
          action,
          status: 'SIMULATED',
          mode: 'dry-run',
          ruleId
        };
      }

      if (this.mode === 'enforce') {
        try {
          await execAsync(`sudo -n iptables -I INPUT -s ${sourceIp} -j DROP -m comment --comment "${ruleId}"`);
          console.log(`[Action Executor] ENFORCE BLOCK: Blocked ${sourceIp} via iptables (Rule: ${ruleId})`);
          
          // Schedule auto-removal
          setTimeout(() => {
            this.removeBlock(sourceIp, ruleId).catch(err => {
              console.error(`[Action Executor] Failed to auto-remove block rule ${ruleId} for ${sourceIp}:`, err);
            });
          }, this.blockDuration * 1000);

          return {
            action,
            status: 'SUCCESS',
            mode: 'enforce',
            ruleId
          };
        } catch (error: any) {
          console.error(`[Action Executor] ENFORCE BLOCK FAILED for ${sourceIp}:`, error);
          return {
            action,
            status: 'FAILED',
            mode: 'enforce',
            ruleId,
            errorMessage: error.message || 'iptables command failed'
          };
        }
      }
    }

    return {
      action,
      status: 'FAILED',
      mode: this.mode,
      errorMessage: `Unknown action: ${action}`
    };
  }

  private async removeBlock(sourceIp: string, ruleId: string): Promise<void> {
    if (!net.isIP(sourceIp)) return;
    try {
      await execAsync(`sudo -n iptables -D INPUT -s ${sourceIp} -j DROP -m comment --comment "${ruleId}"`);
      console.log(`[Action Executor] Auto-removed block for ${sourceIp} (Rule: ${ruleId})`);
    } catch (e: any) {
      console.error(`[Action Executor] Could not cleanly remove iptables rule ${ruleId}:`, e.message);
    }
  }
}

export const actionExecutor = new ActionExecutor();
