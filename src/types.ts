export interface ParamConfigItem {
  b1: number;
  b2: number;
  unit: string;
  name: string;
  keywords: string[];
}

export interface RemedialMeasure {
  method: string;
  principle: string;
  suitability: string;
  adv: string;
}

export type ParamConfigMap = Record<string, ParamConfigItem>;
export type RemedialMeasuresMap = Record<string, RemedialMeasure[]>;

export interface DataHeaders {
  state?: string;
  district?: string;
  block?: string;
  wellId?: string;
  location?: string;
  longitude?: string;
  latitude?: string;
  year?: string;
  season?: string;
  aquifer?: string;
  params: string[];
}

export interface GroupedStatRow {
  name: string;
  state: string;
  district: string;
  block: string;
  total: number;
  nAcc: number;
  nPctAcc: number;
  nPerm: number;
  nPctPerm: number;
  nFail: number;
  nPctFail: number;
  min: number;
  max: number;
  avg: number;
  std: number;
  nSarS1?: number;
  nPctSarS1?: number;
  nSarS2?: number;
  nPctSarS2?: number;
  nSarS3?: number;
  nPctSarS3?: number;
  nSarS4?: number;
  nPctSarS4?: number;
}

export interface ExceedingLocationItem {
  block: string;
  location: string;
  lat: string;
  lon: string;
  count: number;
  names: string;
  details: string;
  type: string;
  rawParams: string[];
}
