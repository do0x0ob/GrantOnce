import { keyPairFromSeed, type KeyPair } from "./crypto";
import type { IssuerId } from "./claims";
import { ISSUERS } from "./claims";
import type { AgencyId } from "./types";

/**
 * Deterministic demo keys so a restart keeps the same identities.
 *
 * In production only the public half of each agency key would live here — the
 * private half stays at the agency (GCA 政府憑證管理中心 機關憑證, or an mTLS
 * client certificate). The demo holds both so one process can play every role.
 */
const AGENCY_SEEDS: Record<AgencyId, string> = {
  jia: "agency/new-taipei-social-affairs",
  yi: "agency/moea-energy-taipower",
};

const ISSUER_SEEDS: Record<IssuerId, string> = {
  "household-office": "issuer/household-office",
  taipower: "issuer/taipower",
  nhia: "issuer/nhia",
  tax: "issuer/tax",
};

export const AGENCY_KEYS: Record<AgencyId, KeyPair> = {
  jia: keyPairFromSeed(AGENCY_SEEDS.jia),
  yi: keyPairFromSeed(AGENCY_SEEDS.yi),
};

export const ISSUER_KEYS: Record<IssuerId, KeyPair> = {
  "household-office": keyPairFromSeed(ISSUER_SEEDS["household-office"]),
  taipower: keyPairFromSeed(ISSUER_SEEDS.taipower),
  nhia: keyPairFromSeed(ISSUER_SEEDS.nhia),
  tax: keyPairFromSeed(ISSUER_SEEDS.tax),
};

export const AGENCY_NAMES: Record<AgencyId, string> = {
  jia: "甲｜新北市政府社會局",
  yi: "乙｜經濟部能源署 × 台灣電力公司",
};

export function issuerName(id: IssuerId): string {
  return ISSUERS[id].name;
}

export function isKnownAgency(value: string): value is AgencyId {
  return value === "jia" || value === "yi";
}
