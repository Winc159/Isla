import { Agent, fetch as undiciFetch } from "undici";
import type { Dispatcher, Response } from "undici";
import type { LookupOptions } from "node:dns";
import type { PublicAddress } from "./network.js";

export interface PinnedResponse { readonly response: Response; readonly close: () => Promise<void>; }
export interface PinnedTransportDeps {
  readonly createAgent: (addresses: readonly PublicAddress[]) => { readonly dispatcher: Dispatcher; readonly close: () => Promise<void> };
  readonly fetch: typeof undiciFetch;
}

export async function requestPinned(url: URL, addresses: readonly PublicAddress[], headers: Record<string, string>, signal: AbortSignal, deps: PinnedTransportDeps = productionDeps): Promise<PinnedResponse> {
  const resource = deps.createAgent(addresses);
  try {
    const response = await deps.fetch(url, { method: "GET", redirect: "manual", headers, signal, dispatcher: resource.dispatcher });
    return { response, close: resource.close };
  } catch (error) {
    await resource.close();
    throw error;
  }
}

export function createPinnedLookup(addresses: readonly PublicAddress[]): (hostname: string, options: LookupOptions, callback: LookupCallback) => void {
  return (hostname, options, callback) => {
    const family = typeof options.family === "number" ? options.family : options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : 0;
    const eligible = family === 0 ? addresses : addresses.filter(address => address.family === family);
    if (eligible.length === 0) {
      const error = Object.assign(new Error(`no validated address for ${hostname}`), { code: "ENOTFOUND", hostname });
      callback(error, options.all === true ? [] : "", family);
      return;
    }
    if (options.all === true) { callback(null, eligible.map(address => ({ address: address.address, family: address.family }))); return; }
    const selected = eligible[0]!;
    callback(null, selected.address, selected.family);
  };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function productionAgent(addresses: readonly PublicAddress[]) {
  const dispatcher = new Agent({ autoSelectFamily: true, connect: { lookup: createPinnedLookup(addresses) } });
  return { dispatcher, close: () => dispatcher.close() };
}

const productionDeps: PinnedTransportDeps = { createAgent: productionAgent, fetch: undiciFetch };
