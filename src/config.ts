/**
 * Runtime config — reads/writes API keys to %APPDATA%/buddy/config.json
 * via tauri-plugin-store. Keys are never baked into the binary.
 */
import { load } from "@tauri-apps/plugin-store"

const STORE_FILE = "config.json"

export interface Config {
  anthropicApiKey: string
  elevenLabsApiKey: string
  elevenLabsVoiceId: string
}

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} })
}

export async function loadConfig(): Promise<Partial<Config>> {
  const store = await getStore()
  return {
    anthropicApiKey:   (await store.get<string>("anthropicApiKey"))   ?? "",
    elevenLabsApiKey:  (await store.get<string>("elevenLabsApiKey"))  ?? "",
    elevenLabsVoiceId: (await store.get<string>("elevenLabsVoiceId")) ?? "",
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  const store = await getStore()
  await store.set("anthropicApiKey",   cfg.anthropicApiKey)
  await store.set("elevenLabsApiKey",  cfg.elevenLabsApiKey)
  await store.set("elevenLabsVoiceId", cfg.elevenLabsVoiceId)
}

export async function isConfigured(): Promise<boolean> {
  const cfg = await loadConfig()
  return !!(cfg.anthropicApiKey && cfg.elevenLabsApiKey && cfg.elevenLabsVoiceId)
}
