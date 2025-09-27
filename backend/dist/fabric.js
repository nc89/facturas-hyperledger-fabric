"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fabricService = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const fabric_network_1 = require("fabric-network");
const http_errors_1 = __importDefault(require("http-errors"));
class FabricService {
    constructor() {
        this.gateways = new Map();
        this.wallets = new Map();
        this.profiles = new Map();
        this.defaultWalletPath = process.env.FABRIC_WALLET_PATH || path_1.default.resolve(process.cwd(), 'wallet');
    }
    getProfilePath(binding) {
        const envOverride = process.env[`FABRIC_CONNECTION_PROFILE_${binding.mspId}`];
        const fallback = process.env.FABRIC_CONNECTION_PROFILE;
        const result = binding.connectionProfile || envOverride || fallback;
        if (!result) {
            throw (0, http_errors_1.default)(500, `Sin ruta de connection profile para ${binding.mspId}`);
        }
        return path_1.default.isAbsolute(result) ? result : path_1.default.resolve(process.cwd(), result);
    }
    async readConnectionProfile(binding) {
        const pathKey = this.getProfilePath(binding);
        if (this.profiles.has(pathKey)) {
            return this.profiles.get(pathKey);
        }
        const content = await fs_1.promises.readFile(pathKey, 'utf8');
        const profile = JSON.parse(content);
        this.profiles.set(pathKey, profile);
        return profile;
    }
    async getWallet(binding) {
        const walletPath = binding.walletPath || process.env[`FABRIC_WALLET_PATH_${binding.mspId}`] || this.defaultWalletPath;
        const resolved = path_1.default.isAbsolute(walletPath) ? walletPath : path_1.default.resolve(process.cwd(), walletPath);
        if (this.wallets.has(resolved)) {
            return this.wallets.get(resolved);
        }
        const wallet = await fabric_network_1.Wallets.newFileSystemWallet(resolved);
        this.wallets.set(resolved, wallet);
        return wallet;
    }
    async ensureGateway(binding) {
        const key = `${binding.mspId}:${binding.label}:${binding.connectionProfile || ''}:${binding.walletPath || ''}`;
        if (this.gateways.has(key)) {
            return this.gateways.get(key);
        }
        const profile = await this.readConnectionProfile(binding);
        const wallet = await this.getWallet(binding);
        const identity = await wallet.get(binding.label);
        if (!identity) {
            throw (0, http_errors_1.default)(500, `Identidad ${binding.label} no encontrada en wallet`);
        }
        const gateway = new fabric_network_1.Gateway();
        const options = {
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
    async getContract(binding, channel, chaincode) {
        const gateway = await this.ensureGateway(binding);
        const network = await gateway.getNetwork(channel);
        return network.getContract(chaincode);
    }
    async submit(binding, channel, chaincode, name, args = [], options) {
        const contract = await this.getContract(binding, channel, chaincode);
        const tx = contract.createTransaction(name);
        if (options?.transient) {
            tx.setTransient(options.transient);
        }
        return tx.submit(...args);
    }
    async evaluate(binding, channel, chaincode, name, args = []) {
        const contract = await this.getContract(binding, channel, chaincode);
        return contract.evaluateTransaction(name, ...args);
    }
    async addContractListener(binding, channel, chaincode, listener, options) {
        const contract = await this.getContract(binding, channel, chaincode);
        return contract.addContractListener(listener, options);
    }
    async removeContractListener(binding, channel, chaincode, listener) {
        const contract = await this.getContract(binding, channel, chaincode);
        contract.removeContractListener(listener);
    }
    async disconnect() {
        for (const gateway of this.gateways.values()) {
            gateway.disconnect();
        }
        this.gateways.clear();
    }
}
exports.fabricService = new FabricService();
