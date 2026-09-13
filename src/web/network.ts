import { lookup as systemLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { WebFetchError } from "./errors.js";

export interface PublicAddress { readonly address: string; readonly family: 4 | 6; }
export type AddressResolver = (hostname: string, options: { readonly all: true; readonly order: "verbatim" }) => Promise<LookupAddress[]>;

const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96] as const;
const IPV4ONLY_DISCOVERY_HOST = "ipv4only.arpa";
const IPV4ONLY_SENTINELS = new Set(["192.0.0.170", "192.0.0.171"]);

export function isPublicIpAddress(input: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try { parsed = ipaddr.parse(stripBrackets(input)); } catch { return false; }
  if (parsed instanceof ipaddr.IPv4) return parsed.range() === "unicast";
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === "unicast";
  return parsed.range() === "unicast";
}

export function isNonPublicIpLiteral(hostname: string): boolean {
  const value = stripBrackets(hostname);
  return isIP(value) !== 0 && !isPublicIpAddress(value);
}

export async function resolvePublicAddresses(hostname: string, signal: AbortSignal, resolver: AddressResolver = systemLookup): Promise<PublicAddress[]> {
  if (signal.aborted) throw new WebFetchError("TURN_CANCELLED", "当前回合已取消。");
  const value = stripBrackets(hostname);
  const family = isIP(value);
  const resolved = family === 0 ? await raceWithSignal(resolver(value, { all: true, order: "verbatim" }), signal) : [{ address: value, family }];
  if (resolved.length === 0) throw new WebFetchError("WEB_NETWORK_ERROR", "hostname 未解析到地址。");
  const addresses = resolved.map(entry => {
    if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) throw new WebFetchError("WEB_NETWORK_ERROR", "DNS 返回了无效地址。");
    if (!isPublicIpAddress(entry.address)) throw new WebFetchError("WEB_BLOCKED_URL", "目标解析到了非公网地址。");
    return { address: entry.address, family: entry.family as 4 | 6 };
  });
  const nat64Prefixes = addresses.some(entry => entry.family === 6) ? await discoverNat64Prefixes(signal, resolver) : [];
  for (const address of addresses) {
    const translated = translatedIpv4Address(address.address, nat64Prefixes);
    if (translated !== undefined && !isPublicIpAddress(translated)) throw new WebFetchError("WEB_BLOCKED_URL", "目标通过 NAT64 解析到了非公网地址。");
  }
  return addresses;
}

interface Nat64Prefix { readonly bytes: readonly number[]; readonly length: typeof RFC6052_PREFIX_LENGTHS[number]; }

async function discoverNat64Prefixes(signal: AbortSignal, resolver: AddressResolver): Promise<Nat64Prefix[]> {
  const discovered = await raceWithSignal(resolver(IPV4ONLY_DISCOVERY_HOST, { all: true, order: "verbatim" }), signal);
  const prefixes: Nat64Prefix[] = [];
  const seen = new Set<string>();
  for (const entry of discovered) {
    if (entry.family !== 6 || isIP(entry.address) !== 6) continue;
    const bytes = ipaddr.parse(entry.address).toByteArray();
    for (const length of RFC6052_PREFIX_LENGTHS) {
      const embedded = embeddedIpv4Address(bytes, length);
      if (embedded === undefined || !IPV4ONLY_SENTINELS.has(embedded)) continue;
      const prefixBytes = bytes.slice(0, length / 8);
      const key = `${length}:${prefixBytes.join(".")}`;
      if (!seen.has(key)) { seen.add(key); prefixes.push({ bytes: prefixBytes, length }); }
    }
  }
  return prefixes;
}

function translatedIpv4Address(input: string, prefixes: readonly Nat64Prefix[]): string | undefined {
  if (isIP(input) !== 6) return undefined;
  const bytes = ipaddr.parse(input).toByteArray();
  for (const prefix of prefixes) {
    if (prefix.bytes.every((byte, index) => bytes[index] === byte)) return embeddedIpv4Address(bytes, prefix.length);
  }
  return undefined;
}

function embeddedIpv4Address(bytes: readonly number[], length: typeof RFC6052_PREFIX_LENGTHS[number]): string | undefined {
  if (length === 96) return bytes.slice(12, 16).join(".");
  if (bytes[8] !== 0) return undefined;
  const prefixBytes = length / 8;
  const beforeReserved = 8 - prefixBytes;
  return [...bytes.slice(prefixBytes, prefixBytes + beforeReserved), ...bytes.slice(9, 9 + 4 - beforeReserved)].join(".");
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new WebFetchError("TURN_CANCELLED", "当前回合已取消。"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new WebFetchError("TURN_CANCELLED", "当前回合已取消。"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function stripBrackets(value: string): string { return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value; }
