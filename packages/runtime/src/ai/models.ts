// This module is imported by the RENDERER (settings panels list models).
// Use direct `fetch` instead of the OpenAI / Anthropic SDK clients to keep
// renderer bundle size down and -- more importantly -- avoid pulling the
// Anthropic SDK's Node-only `agent-toolset` subtree into the browser bundle
// (it imports node:fs / node:crypto and breaks the renderer build).

export interface AIModelInfo { id: string; name: string }

export async function getOpenAIModels(apiKey?: string, baseUrl?: string): Promise<AIModelInfo[]> {
  const FALLBACK: AIModelInfo[] = [
    { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
    { id: 'gpt-4o', name: 'gpt-4o' },
    { id: 'gpt-4-turbo', name: 'gpt-4-turbo' },
  ];
  try {
    if (!apiKey) throw new Error('no key');
    const root = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const res = await fetch(`${root}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data: any = await res.json();
    if (Array.isArray(data?.data)) {
      return data.data.map((m: any) => ({ id: m.id, name: m.id }));
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function getAnthropicModels(apiKey?: string, baseUrl?: string): Promise<AIModelInfo[]> {
  const FALLBACK: AIModelInfo[] = [
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
  ];
  try {
    if (!apiKey) throw new Error('no key');
    const root = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await fetch(`${root}/v1/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data: any = await res.json();
    if (Array.isArray(data?.data)) {
      return data.data.map((m: any) => ({ id: m.id, name: m.display_name || m.id }));
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function getLMStudioModels(baseUrl: string): Promise<AIModelInfo[]> {
  try {
    const root = baseUrl.replace(/\/$/, '');
    const res = await fetch(`${root}/models`);
    const data = await res.json();
    if (Array.isArray(data?.data)) {
      return data.data.map((m: any) => ({ id: m.id || m.name || m, name: m.id || m.name || m }));
    }
    return [];
  } catch {
    return [];
  }
}

