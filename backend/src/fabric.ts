import { promises as fs } from 'fs';
import path from 'path';
import { Contract, Gateway, GatewayOptions, ListenerOptions, Wallet, Wallets, ContractListener, X509Identity } from 'fabric-network';
import createError from 'http-errors';
import { FabricIdentityBinding } from './auth';

interface SubmitOptions {
  transient?: Record<string, Buffer>;
}

class FabricService {
  private gateways = new Map<string, Gateway>();
  private wallets = new Map<string, Wallet>();
  private profiles = new Map<string, Record<string, unknown>>();
  private defaultWalletPath = process.env.FABRIC_WALLET_PATH || path.resolve(process.cwd(), 'wallet');

  private gatewayKey(binding: FabricIdentityBinding): string {
    return `${binding.mspId}:${binding.label}:${binding.connectionProfile || ''}:${binding.walletPath || ''}`;
  }

  private async readConnectionProfile(binding: FabricIdentityBinding): Promise<Record<string, unknown>> {
    const envOverride = process.env[`FABRIC_CONNECTION_PROFILE_${binding.mspId}`];
    const fallback = process.env.FABRIC_CONNECTION_PROFILE;
    const configured = binding.connectionProfile || envOverride || fallback;
    if (!configured) {
      throw createError(500, `Sin ruta de connection profile para ${binding.mspId}`);
    }

    const candidates: string[] = [];
    if (path.isAbsolute(configured)) {
      candidates.push(configured);
    } else {
      candidates.push(path.resolve(process.cwd(), configured));
      candidates.push(path.resolve(process.cwd(), '..', configured));
    }

    let selected: string | undefined;
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        selected = candidate;
        break;
      } catch {
        // continue trying other candidates
      }
    }

    const pathKey = selected || candidates[0];
    if (this.profiles.has(pathKey)) {
      return this.profiles.get(pathKey)!;
    }
    const content = await fs.readFile(pathKey, 'utf8');
    const profile = JSON.parse(content) as Record<string, unknown>;
    this.profiles.set(pathKey, profile);
    return profile;
  }

  private async getWallet(binding: FabricIdentityBinding): Promise<Wallet> {
    const walletPath = binding.walletPath || process.env[`FABRIC_WALLET_PATH_${binding.mspId}`] || this.defaultWalletPath;
    const resolved = path.isAbsolute(walletPath) ? walletPath : path.resolve(process.cwd(), walletPath);
    if (this.wallets.has(resolved)) {
      return this.wallets.get(resolved)!;
    }
    const wallet = await Wallets.newFileSystemWallet(resolved);
    this.wallets.set(resolved, wallet);
    return wallet;
  }

  private async ensureGateway(binding: FabricIdentityBinding): Promise<Gateway> {
    const key = this.gatewayKey(binding);
    if (this.gateways.has(key)) {
      return this.gateways.get(key)!;
    }

    const profile = await this.readConnectionProfile(binding);
    const wallet = await this.getWallet(binding);

    const identity = await wallet.get(binding.label);
    if (!identity) {
      throw createError(500, `Identidad ${binding.label} no encontrada en wallet`);
    }

    const gateway = new Gateway();
    const options: GatewayOptions = {
      identity: binding.label,
      wallet,
      discovery: {
        enabled: process.env.FABRIC_DISCOVERY_ENABLED !== 'false',
        asLocalhost: process.env.FABRIC_DISCOVERY_AS_LOCALHOST !== 'false',
      },
    };
    await gateway.connect(profile, options);
    this.gateways.set(key, gateway);
    return gateway;
  }

  private invalidateGateway(binding: FabricIdentityBinding): void {
    const key = this.gatewayKey(binding);
    const existing = this.gateways.get(key);
    if (existing) {
      existing.disconnect();
      this.gateways.delete(key);
    }
  }

  async storeIdentity(
    binding: FabricIdentityBinding,
    certificate: string,
    privateKey: string,
    overwrite = false,
  ): Promise<'created' | 'updated'> {
    const wallet = await this.getWallet(binding);
    const current = await wallet.get(binding.label);
    if (current && !overwrite) {
      throw createError(409, `La identidad ${binding.label} ya existe en el wallet ${binding.walletPath || 'default'}`);
    }

    const identity: X509Identity = {
      credentials: {
        certificate,
        privateKey,
      },
      mspId: binding.mspId,
      type: 'X.509',
    };

    await wallet.put(binding.label, identity);
    this.invalidateGateway(binding);

    return current ? 'updated' : 'created';
  }

  private async getContract(binding: FabricIdentityBinding, channel: string, chaincode: string): Promise<Contract> {
    const gateway = await this.ensureGateway(binding);
    const network = await gateway.getNetwork(channel);
    return network.getContract(chaincode);
  }

  async submit(
    binding: FabricIdentityBinding,
    channel: string,
    chaincode: string,
    name: string,
    args: string[] = [],
    options?: SubmitOptions,
  ): Promise<Buffer> {
    const contract = await this.getContract(binding, channel, chaincode);
    const tx = contract.createTransaction(name);
    if (options?.transient) {
      tx.setTransient(options.transient);
    }
    return tx.submit(...args);
  }

  async evaluate(
    binding: FabricIdentityBinding,
    channel: string,
    chaincode: string,
    name: string,
    args: string[] = [],
  ): Promise<Buffer> {
    const contract = await this.getContract(binding, channel, chaincode);
    return contract.evaluateTransaction(name, ...args);
  }

  async addContractListener(
    binding: FabricIdentityBinding,
    channel: string,
    chaincode: string,
    listener: ContractListener,
    options?: ListenerOptions,
  ) {
    const contract = await this.getContract(binding, channel, chaincode);
    return contract.addContractListener(listener, options);
  }

  async removeContractListener(
    binding: FabricIdentityBinding,
    channel: string,
    chaincode: string,
    listener: ContractListener,
  ) {
    const contract = await this.getContract(binding, channel, chaincode);
    contract.removeContractListener(listener);
  }

  async disconnect(): Promise<void> {
    for (const gateway of this.gateways.values()) {
      gateway.disconnect();
    }
    this.gateways.clear();
  }
}

export const fabricService = new FabricService();
