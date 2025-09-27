import fs from 'fs';
import path from 'path';
import { FabricIdentityBinding } from './auth';

const CONFIG_FILE = path.resolve(__dirname, '../config/api-keys.json');

function parseEnvBindings(): FabricIdentityBinding[] {
  const raw = process.env.FABRIC_API_KEYS || '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split('|').map((part) => part.trim());
      if (parts.length < 3) {
        throw new Error(`Formato inválido en FABRIC_API_KEYS: ${entry}`);
      }
      const [apiKey, mspId, label, profile, walletPath] = parts;
      return {
        apiKey,
        mspId,
        label,
        connectionProfile: profile || process.env.FABRIC_CONNECTION_PROFILE,
        walletPath: walletPath || process.env.FABRIC_WALLET_PATH,
      } as FabricIdentityBinding;
    });
}

function parseFileBindings(): FabricIdentityBinding[] {
  if (!fs.existsSync(CONFIG_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed as FabricIdentityBinding[];
    }
    if (parsed && Array.isArray(parsed.bindings)) {
      return parsed.bindings as FabricIdentityBinding[];
    }
    return [];
  } catch (err) {
    console.warn('[bindings-store] No pude leer config/api-keys.json:', err);
    return [];
  }
}

class BindingsStore {
  private bindings = new Map<string, FabricIdentityBinding>();

  constructor() {
    this.reload();
  }

  private normalise(binding: FabricIdentityBinding): FabricIdentityBinding {
    return {
      ...binding,
      connectionProfile: binding.connectionProfile || process.env.FABRIC_CONNECTION_PROFILE,
      walletPath: binding.walletPath || process.env.FABRIC_WALLET_PATH,
    };
  }

  reload(): void {
    this.bindings.clear();
    const defaults = parseEnvBindings();
    const fileBindings = parseFileBindings();
    [...defaults, ...fileBindings].forEach((binding) => {
      const normalised = this.normalise(binding);
      this.bindings.set(normalised.apiKey, normalised);
    });
  }

  get(apiKey: string): FabricIdentityBinding | undefined {
    return this.bindings.get(apiKey);
  }

  getAll(): FabricIdentityBinding[] {
    return Array.from(this.bindings.values());
  }

  async upsert(binding: FabricIdentityBinding): Promise<void> {
    const normalised = this.normalise(binding);
    this.bindings.set(normalised.apiKey, normalised);
    await this.persistToFile();
  }

  private async persistToFile(): Promise<void> {
    const output = { bindings: this.getAll() };
    await fs.promises.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(output, null, 2), 'utf8');
  }
}

export const bindingsStore = new BindingsStore();
